import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopFileService, readChosenCsv, writeHistoryBundle, type FileDialogs } from './file-operations.js';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'cash-sloth-file-operations-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true, maxRetries: 5 }); });
const batch = () => ({ saleCount: 1, generatedAt: '2026-11-18T08:00:00.000Z', files: ['sales.csv', 'sale_items.csv', 'payments.csv', 'refunds.csv', 'refund_items.csv'].map((name) => ({ name, content: 'sale_id,amount_rappen\r\nsale-test,842\r\n' })) });
const request = { filters: { dateFrom: null, dateTo: null, paymentMethod: 'all' as const, minTotalRappen: null, maxTotalRappen: null, refundStatus: 'all' as const, saleId: '', productQuery: '' }, sort: { field: 'date' as const, direction: 'desc' as const } };

describe('host-mediated CSV input', () => {
  it('preserves UTF-8 text, optional BOM and quoted content while exposing only a basename', async () => {
    for (const bom of ['', '\uFEFF']) {
      const path = join(directory, 'catalog.csv');
      const text = `${bom}product;variant;price\r\n"Sören café";"Large; sweet";"2,42"\r\n`;
      await writeFile(path, text, 'utf8');
      expect(await readChosenCsv(path)).toEqual({ name: 'catalog.csv', text, encoding: bom ? 'UTF-8 BOM' : 'UTF-8' });
    }
  });
  it.each([Buffer.from([0xff, 0xfe, 0x41, 0]), Buffer.from([0x53, 0, 0x61, 0]), Buffer.from([0xc3, 0x28])])('rejects unsupported or malformed encoding %j', async (bytes) => {
    const path = join(directory, 'invalid.csv'); await writeFile(path, bytes);
    await expect(readChosenCsv(path)).rejects.toThrow(/UTF/u);
  });
  it('rejects oversized files before reading unbounded content', async () => {
    const path = join(directory, 'large.csv'); await writeFile(path, Buffer.alloc(2 * 1024 * 1024 + 1, 65));
    await expect(readChosenCsv(path)).rejects.toThrow('2 MiB');
  });
  it('never accepts a renderer path and does not open a chooser on malformed input', async () => {
    const choose = vi.fn(async () => null);
    const service = createDesktopFileService({ chooseCatalogCsv: choose, chooseExportDirectory: choose }, () => ({ ok: true, value: batch() }));
    const result = await service.chooseCatalogCsv({ path: 'private.csv' } as never);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } }); expect(choose).not.toHaveBeenCalled();
  });
  it('treats chooser cancellation as an explicit result and performs no export preparation', async () => {
    const dialogs: FileDialogs = { chooseCatalogCsv: async () => null, chooseExportDirectory: async () => null };
    const prepare = vi.fn(() => ({ ok: true as const, value: batch() }));
    const service = createDesktopFileService(dialogs, prepare);
    expect(await service.chooseCatalogCsv({})).toEqual({ ok: true, value: { cancelled: true } });
    expect(await service.exportSalesHistory(request)).toEqual({ ok: true, value: { cancelled: true } });
    expect(prepare).not.toHaveBeenCalled(); expect(await readdir(directory)).toEqual([]);
  });
  it('prevents simultaneous file dialogs without duplicating a pending operation', async () => {
    let finish: (path: string | null) => void = () => { throw new Error('Chooser not opened'); };
    const service = createDesktopFileService({ chooseCatalogCsv: () => new Promise((resolve) => { finish = resolve; }), chooseExportDirectory: async () => directory }, () => ({ ok: true, value: batch() }));
    const pending = service.chooseCatalogCsv({});
    expect(await service.exportSalesHistory(request)).toMatchObject({ ok: false, error: { code: 'FILE_BUSY' } });
    finish(null); await pending;
  });
});

describe('complete financial export directories', () => {
  it('publishes exactly five linked files in a fresh directory and never overwrites existing user files', async () => {
    await writeFile(join(directory, 'sales.csv'), 'existing user file');
    const first = await writeHistoryBundle(directory, batch());
    const second = await writeHistoryBundle(directory, batch());
    expect(first).not.toBe(second);
    expect((await readdir(first)).sort()).toEqual(batch().files.map((file) => file.name).sort());
    expect(await readFile(join(first, 'sales.csv'), 'utf8')).toBe(batch().files[0]?.content);
    expect(await readFile(join(directory, 'sales.csv'), 'utf8')).toBe('existing user file');
    expect((await readdir(directory)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });
  it('rejects traversal, duplicate names and excessive bytes without creating output', async () => {
    const malicious = [
      { ...batch(), files: [{ name: '../sales.csv', content: 'bad' }, ...batch().files.slice(1)] },
      { ...batch(), files: batch().files.map((file) => ({ ...file, name: 'sales.csv' })) },
      { ...batch(), files: batch().files.map((file) => ({ ...file, content: 'X'.repeat(6 * 1024 * 1024) })) },
    ];
    for (const value of malicious) await expect(writeHistoryBundle(directory, value)).rejects.toThrow('invalid file structure');
    expect(await readdir(directory)).toEqual([]);
  });
  it('creates no files when export preparation rejects a large or invalid query', async () => {
    const service = createDesktopFileService({ chooseCatalogCsv: async () => null, chooseExportDirectory: async () => directory }, () => ({ ok: false, error: { code: 'EXPORT_LIMIT', message: 'Narrow the filters before exporting.' } }));
    expect(await service.exportSalesHistory(request)).toMatchObject({ ok: false, error: { code: 'EXPORT_LIMIT' } });
    expect(await readdir(directory)).toEqual([]);
  });
  it('returns the published location only after a complete write', async () => {
    const parent = join(directory, 'chosen'); await mkdir(parent);
    const service = createDesktopFileService({ chooseCatalogCsv: async () => null, chooseExportDirectory: async () => parent }, () => ({ ok: true, value: batch() }));
    const result = await service.exportSalesHistory(request);
    if (!result.ok || result.value.cancelled) throw new Error('Expected a completed export');
    expect(result.value.saleCount).toBe(1); expect(await readdir(result.value.directory)).toHaveLength(5);
  });
  it('removes only its staging folder after a mid-write failure without publishing a partial export', async () => {
    await writeFile(join(directory, 'keep.txt'), 'unrelated user content');
    await expect(writeHistoryBundle(directory, batch(), { beforeWrite: (name) => { if (name === 'payments.csv') throw new Error('Injected write failure'); } })).rejects.toThrow('Injected write failure');
    expect(await readdir(directory)).toEqual(['keep.txt']);
    expect(await readFile(join(directory, 'keep.txt'), 'utf8')).toBe('unrelated user content');
  });
  it('publishes no final directory if interruption occurs immediately before its atomic rename', async () => {
    await expect(writeHistoryBundle(directory, batch(), { beforePublish: () => { throw new Error('Injected publication failure'); } })).rejects.toThrow('Injected publication failure');
    expect(await readdir(directory)).toEqual([]);
  });
});
