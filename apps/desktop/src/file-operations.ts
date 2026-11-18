import { open, mkdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { FILES_IPC_CONTRACTS, type FilesApi, type FilesMethod, type FilesRequest, type FilesResponse, type HistoryExportRequest, type Result } from '@cash-sloth/contracts';

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_EXPORT_BYTES = 25 * 1024 * 1024;
const EXPORT_NAMES = ['sales.csv', 'sale_items.csv', 'payments.csv', 'refunds.csv', 'refund_items.csv'] as const;
interface PreparedFileExport { readonly files: readonly { readonly name: string; readonly content: string }[]; readonly saleCount: number; readonly generatedAt: string }
export interface ExportFileTestHooks {
  /** Test-only fault injection; never configured through IPC or by production hosts. */
  beforeWrite?(name: string): void;
  beforePublish?(): void;
}
export interface FileDialogs {
  chooseCatalogCsv(): Promise<string | null>;
  chooseExportDirectory(): Promise<string | null>;
}
class FileOperationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** The path comes exclusively from a native user chooser, never a renderer argument. */
export async function readChosenCsv(path: string): Promise<{ name: string; text: string; encoding: 'UTF-8' | 'UTF-8 BOM' }> {
  const file = await open(path, 'r');
  try {
    const before = await file.stat();
    if (!before.isFile()) throw new FileOperationError('INVALID_FILE', 'Choose a regular CSV file.');
    if (before.size > MAX_CSV_BYTES) throw new FileOperationError('FILE_TOO_LARGE', 'The CSV file exceeds the 2 MiB import limit.');
    const bytes = Buffer.alloc(MAX_CSV_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > MAX_CSV_BYTES) throw new FileOperationError('FILE_TOO_LARGE', 'The CSV file exceeds the 2 MiB import limit.');
    const after = await file.stat();
    if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new FileOperationError('FILE_CHANGED', 'The file changed while it was read. Choose it again before previewing.');
    }
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length)); }
    catch { throw new FileOperationError('UNSUPPORTED_ENCODING', 'Only valid UTF-8 CSV files, with or without a UTF-8 BOM, are supported.'); }
    if (text.includes('\0')) throw new FileOperationError('UNSUPPORTED_ENCODING', 'NUL bytes or UTF-16 input are unsupported. Save the CSV as UTF-8.');
    return { name: basename(path), text, encoding: text.startsWith('\uFEFF') ? 'UTF-8 BOM' : 'UTF-8' };
  } finally { await file.close(); }
}

function requireChild(parent: string, child: string): void {
  const suffix = relative(parent, resolve(child));
  if (suffix === '' || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) throw new FileOperationError('INVALID_EXPORT', 'The export destination is invalid.');
}

/** Publish a complete new directory. Existing files are never overwritten. */
export async function writeHistoryBundle(parentPath: string, batch: PreparedFileExport, hooks: ExportFileTestHooks = {}): Promise<string> {
  if (!Number.isSafeInteger(batch.saleCount) || batch.saleCount < 0 || batch.saleCount > 5000 ||
      !Number.isFinite(Date.parse(batch.generatedAt)) || batch.files.length !== EXPORT_NAMES.length ||
      new Set(batch.files.map((file) => file.name)).size !== EXPORT_NAMES.length ||
      batch.files.some((file) => !EXPORT_NAMES.some((name) => name === file.name) || typeof file.content !== 'string') ||
      batch.files.reduce((total, file) => total + Buffer.byteLength(file.content, 'utf8'), 0) > MAX_EXPORT_BYTES) {
    throw new FileOperationError('INVALID_EXPORT', 'The prepared export exceeds supported bounds or has an invalid file structure.');
  }
  const parent = await realpath(parentPath);
  if (!(await stat(parent)).isDirectory()) throw new FileOperationError('INVALID_EXPORT', 'Choose an existing output directory.');
  const identity = randomUUID();
  const stage = resolve(join(parent, `.cash-sloth-export-${identity}.tmp`));
  const destination = resolve(join(parent, `cash-sloth-export-${batch.generatedAt.replace(/[^0-9TZ]/gu, '')}-${identity}`));
  requireChild(parent, stage); requireChild(parent, destination);
  await mkdir(stage);
  let published = false;
  try {
    for (const file of batch.files) {
      const target = resolve(join(stage, file.name));
      requireChild(stage, target);
      hooks.beforeWrite?.(file.name);
      await writeFile(target, file.content, { encoding: 'utf8', flag: 'wx' });
    }
    hooks.beforePublish?.();
    await rename(stage, destination);
    published = true;
    return destination;
  } finally {
    if (!published) {
      // Only remove the freshly created, verified staging child owned by this call.
      requireChild(parent, stage);
      await rm(stage, { recursive: true, force: true });
    }
  }
}

export function createDesktopFileService(dialogs: FileDialogs, prepareExport: (request: HistoryExportRequest) => Result<PreparedFileExport>): FilesApi {
  let active = false;
  const run = async <K extends FilesMethod>(method: K, request: FilesRequest<K>, operation: () => Promise<unknown>): Promise<FilesResponse<K>> => {
    if (!FILES_IPC_CONTRACTS[method].request.safeParse(request).success) return { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid file operation request.' } } as FilesResponse<K>;
    if (active) return { ok: false, error: { code: 'FILE_BUSY', message: 'Another file operation is already open. Complete or cancel it first.' } } as FilesResponse<K>;
    active = true;
    try { return FILES_IPC_CONTRACTS[method].response.parse(await operation()) as FilesResponse<K>; }
    catch (error) {
      return { ok: false, error: error instanceof FileOperationError ? { code: error.code, message: error.message } : { code: 'FILE_ERROR', message: 'The file operation could not be completed. No existing files were overwritten.' } } as FilesResponse<K>;
    } finally { active = false; }
  };
  return {
    chooseCatalogCsv: (request) => run('chooseCatalogCsv', request, async () => {
      const path = await dialogs.chooseCatalogCsv();
      return { ok: true, value: path === null ? { cancelled: true } : { cancelled: false, ...await readChosenCsv(path) } };
    }),
    exportSalesHistory: (request) => run('exportSalesHistory', request, async () => {
      const parent = await dialogs.chooseExportDirectory();
      if (parent === null) return { ok: true, value: { cancelled: true } };
      const prepared = prepareExport(request);
      if (!prepared.ok) return prepared;
      const directory = await writeHistoryBundle(parent, prepared.value);
      return { ok: true, value: { cancelled: false, directory, files: prepared.value.files.map((file) => file.name), saleCount: prepared.value.saleCount, generatedAt: prepared.value.generatedAt } };
    }),
  };
}
