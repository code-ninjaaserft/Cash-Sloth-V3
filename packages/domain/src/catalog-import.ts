import { DomainError } from './models.js';
import { normalizeBarcode, normalizeSku } from './catalog.js';
import { parseChfInput } from './money.js';

export const MAX_CSV_CHARACTERS = 2_097_152;
export const MAX_CSV_ROWS = 10_000;
export interface CsvMapping {
  readonly productKey: number; readonly productName: number; readonly variantKey: number; readonly variantName: number; readonly price: number;
  readonly description: number | null; readonly sku: number | null; readonly barcode: number | null;
  readonly categoryPaths: number | null; readonly productActive: number | null; readonly variantActive: number | null;
}
export interface CsvRow { readonly rowNumber: number; readonly values: readonly string[] }
export interface CsvDocument { readonly encoding: 'UTF-8' | 'UTF-8 BOM'; readonly delimiter: ',' | ';'; readonly headers: readonly string[]; readonly rows: readonly CsvRow[]; readonly totalRows: number }
export interface ImportSourceVariant { readonly key: string; readonly name: string; readonly unitPriceRappen: number; readonly sku: string | null; readonly barcode: string | null; readonly active: boolean; readonly position: number }
export interface ImportSourceProduct { readonly key: string; readonly name: string; readonly description: string | null; readonly active: boolean; readonly paths: readonly (readonly string[])[]; readonly variants: readonly ImportSourceVariant[] }
export interface ImportIssue { readonly rowNumber: number; readonly field: string; readonly code: string; readonly message: string; readonly severity: 'error' | 'warning' }
function hasUnsupportedControls(value: string): boolean {
  for (const character of value) if (/\p{Cc}/u.test(character) && !['\r', '\n', '\t'].includes(character)) return true;
  return false;
}

/** Parsing is bounded and strict; a quote is legal only at a field's first character. */
function parseWithDelimiter(text: string, delimiter: ',' | ';'): readonly CsvRow[] {
  const rows: CsvRow[] = [];
  let values: string[] = []; let field = ''; let quoted = false; let closedQuote = false;
  let physicalLine = 1; let rowStart = 1; let fieldStarted = false; let rowTouched = false;
  const addField = (): void => {
    if (field.length > 4000) throw new DomainError('CSV_FIELD_TOO_LONG', `CSV row ${rowStart}: a field exceeds 4000 characters.`);
    values.push(field); if (values.length > 64) throw new DomainError('CSV_TOO_MANY_COLUMNS', `CSV row ${rowStart}: at most 64 columns are supported.`);
    field = ''; closedQuote = false; fieldStarted = false;
  };
  const addRow = (): void => {
    addField();
    if (rowTouched || values.some((value) => value !== '')) rows.push({ rowNumber: rowStart, values });
    if (rows.length > MAX_CSV_ROWS + 1) throw new DomainError('CSV_TOO_MANY_ROWS', 'CSV supports at most 10000 data rows.');
    values = []; rowTouched = false; rowStart = physicalLine + 1;
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === undefined) break;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closedQuote = true; }
      } else if (character === '\r') {
        if (text[index + 1] === '\n') index++;
        field += '\n'; physicalLine++;
      } else { field += character; if (character === '\n') physicalLine++; }
    } else if (character === delimiter) { rowTouched = true; addField(); }
    else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index++;
      addRow(); physicalLine++; rowStart = physicalLine;
    } else if (character === '"') {
      if (fieldStarted || closedQuote) throw new DomainError('CSV_MALFORMED', `CSV row ${rowStart}: unexpected quote inside an unquoted field.`);
      quoted = true; fieldStarted = true; rowTouched = true;
    } else {
      if (closedQuote) throw new DomainError('CSV_MALFORMED', `CSV row ${rowStart}: unexpected characters after a closing quote.`);
      field += character; fieldStarted = true; rowTouched = true;
    }
    if (field.length > 4000) throw new DomainError('CSV_FIELD_TOO_LONG', `CSV row ${rowStart}: a field exceeds 4000 characters.`);
  }
  if (quoted) throw new DomainError('CSV_MALFORMED', `CSV row ${rowStart}: an opened quoted field was not closed.`);
  if (rowTouched || values.length > 0 || field !== '' || closedQuote) addRow();
  return rows;
}
export function parseCatalogCsv(input: string, requestedDelimiter: 'auto' | ',' | ';'): CsvDocument {
  if (typeof input !== 'string' || input.length > MAX_CSV_CHARACTERS || hasUnsupportedControls(input)) throw new DomainError('CSV_UNSUPPORTED_TEXT', 'CSV must be UTF-8 text without NUL or unsupported control characters, within 2 MiB.');
  let utf8Bytes = 0;
  for (const character of input) {
    const point = character.codePointAt(0) ?? 0;
    if (point >= 0xD800 && point <= 0xDFFF) throw new DomainError('CSV_UNSUPPORTED_TEXT', 'CSV text contains an invalid Unicode surrogate.');
    if (point >= 0xFDD0 && point <= 0xFDEF || (point & 0xFFFF) >= 0xFFFE) throw new DomainError('CSV_UNSUPPORTED_TEXT', 'CSV text contains a Unicode noncharacter.');
    utf8Bytes += point <= 0x7F ? 1 : point <= 0x7FF ? 2 : point <= 0xFFFF ? 3 : 4;
    if (utf8Bytes > MAX_CSV_CHARACTERS) throw new DomainError('CSV_TOO_LARGE', 'CSV UTF-8 content exceeds 2 MiB.');
  }
  const encoding = input.startsWith('\uFEFF') ? 'UTF-8 BOM' : 'UTF-8';
  const text = encoding === 'UTF-8 BOM' ? input.slice(1) : input;
  const candidates = requestedDelimiter === 'auto' ? [',', ';'] as const : [requestedDelimiter];
  const parsed: { delimiter: ',' | ';'; rows: readonly CsvRow[] }[] = [];
  let failure: unknown = null;
  for (const delimiter of candidates) {
    try {
      const rows = parseWithDelimiter(text, delimiter);
      const width = rows[0]?.values.length ?? 0;
      const mismatch = rows.find((row) => row.values.length !== width);
      if (width > 1 && !mismatch) parsed.push({ delimiter, rows });
      else if (width > 1 && mismatch) throw new DomainError('CSV_COLUMN_COUNT', `CSV row ${mismatch.rowNumber}: expected ${width} columns but found ${mismatch.values.length}.`);
      else if (requestedDelimiter !== 'auto') throw new DomainError('CSV_COLUMN_COUNT', 'CSV requires a header and consistent rows with at least two columns.');
    } catch (error) { failure = error; }
  }
  if (parsed.length === 0) {
    if (failure instanceof DomainError) throw failure;
    throw new DomainError('CSV_DELIMITER', 'No consistent comma or semicolon delimiter was found. Select the delimiter explicitly and check every row.');
  }
  if (parsed.length > 1) throw new DomainError('CSV_AMBIGUOUS_DELIMITER', 'Both comma and semicolon are plausible delimiters. Select the intended delimiter explicitly.');
  const selected = parsed[0]; if (!selected) throw new DomainError('CSV_DELIMITER', 'Select a CSV delimiter.');
  const header = selected.rows[0]; if (!header) throw new DomainError('CSV_EMPTY', 'The CSV file has no header.');
  const headers = header.values.map((value) => value.normalize('NFC').trim());
  if (headers.some((value) => !value || /[\p{Cc}\p{Cf}]/u.test(value)) || new Set(headers).size !== headers.length) throw new DomainError('CSV_HEADER', 'CSV headers must be nonempty, printable and distinct.');
  return { encoding, delimiter: selected.delimiter, headers, rows: selected.rows.slice(1), totalRows: selected.rows.length - 1 };
}

export function importName(value: string): string {
  if (/[\p{Cc}\p{Cf}]/u.test(value)) throw new DomainError('INVALID_NAME', 'Names must not contain control or invisible formatting characters.');
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized.length > 200) throw new DomainError('INVALID_NAME', 'A name must contain 1 to 200 characters.');
  return normalized;
}
export function importKey(value: string): string {
  const key = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(key)) throw new DomainError('INVALID_KEY', 'Import keys must contain 1 to 64 ASCII letters, digits, dots, underscores, colons or hyphens.');
  return key;
}
/** Backslash escapes only backslash, > and |. Unescaped | separates paths. */
export function parseCategoryPaths(input: string): readonly (readonly string[])[] {
  if (input.trim() === '') return [];
  if (input.length > 4000) throw new DomainError('CATEGORY_PATH', 'Category paths exceed 4000 characters.');
  const paths: string[][] = []; let path: string[] = []; let part = ''; let escaped = false;
  const addPart = (): void => { path.push(importName(part)); part = ''; };
  const addPath = (): void => {
    addPart();
    if (path.length > 64) throw new DomainError('CATEGORY_PATH', 'An imported category path supports at most 64 levels.');
    if (formatCategoryPath(path).length > 4000) throw new DomainError('CATEGORY_PATH', 'The normalized category path exceeds 4000 characters.');
    paths.push(path); path = [];
    if (paths.length > 32) throw new DomainError('CATEGORY_PATH', 'A row supports at most 32 category paths.');
  };
  for (const character of input) {
    if (escaped) { if (!['\\', '>', '|'].includes(character)) throw new DomainError('CATEGORY_PATH', 'Only \\, > and | may be escaped in category paths.'); part += character; escaped = false; }
    else if (character === '\\') escaped = true;
    else if (character === '>') addPart();
    else if (character === '|') addPath();
    else part += character;
  }
  if (escaped) throw new DomainError('CATEGORY_PATH', 'Category path ends with an incomplete escape.');
  addPath();
  const canonical = new Map(paths.map((entry) => [JSON.stringify(entry), entry]));
  return [...canonical.values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'));
}
export function formatCategoryPath(path: readonly string[]): string { return path.map((part) => part.replace(/[\\>|]/gu, '\\$&')).join(' > '); }
export function parseImportPrice(input: string): number {
  const text = input.trim();
  // Swiss thousands grouping is supported only in complete 3-digit groups.
  const ungrouped = /['’]/u.test(text) ? (() => {
    if (!/^(?:[1-9]\d{0,2})(?:['’]\d{3})+(?:[.,]\d{1,2})?$/u.test(text)) throw new DomainError('INVALID_PRICE', 'Use complete Swiss thousands groups, for example 1\'234.50.');
    return text.replace(/['’]/gu, '');
  })() : text;
  if (!/^\d+(?:[.,]\d{1,2})?$/u.test(ungrouped)) throw new DomainError('INVALID_PRICE', 'Price requires nonnegative CHF with at most two decimal places; no currency symbols or ambiguous thousands separators.');
  return parseChfInput(ungrouped);
}
function importActive(value: string, mapped: boolean): boolean {
  if (!mapped) return true;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'active'].includes(normalized)) return true;
  if (['false', '0', 'inactive'].includes(normalized)) return false;
  throw new DomainError('INVALID_ACTIVE', 'Status must be true/false, 1/0 or active/inactive; mapped values cannot be blank.');
}
export function mapCatalogCsv(document: CsvDocument, mapping: CsvMapping): { products: readonly ImportSourceProduct[]; issues: readonly ImportIssue[]; duplicateRows: number; rowsByVariant: ReadonlyMap<string, number> } {
  const groups = new Map<string, ImportSourceProduct>(); const variants = new Map<string, string>(); const rowsByVariant = new Map<string, number>();
  const issues: ImportIssue[] = []; let duplicateRows = 0;
  for (const [field, index] of Object.entries(mapping)) if (index !== null && (!Number.isSafeInteger(index) || index < 0 || index >= document.headers.length)) throw new DomainError('CSV_MAPPING', `Mapped column for ${field} does not exist.`);
  for (const row of document.rows) {
    const read = (index: number | null): string => index === null ? '' : row.values[index] ?? '';
    let field = 'productKey';
    try {
      const productKey = importKey(read(mapping.productKey)); field = 'productName'; const name = importName(read(mapping.productName));
      field = 'description'; const descriptionValue = read(mapping.description).normalize('NFC').trim();
      if (descriptionValue.length > 4000 || /\p{Cf}/u.test(descriptionValue) || hasUnsupportedControls(descriptionValue)) throw new DomainError('INVALID_DESCRIPTION', 'Description contains unsupported characters or exceeds 4000 characters.');
      const description = descriptionValue || null;
      field = 'productActive'; const active = importActive(read(mapping.productActive), mapping.productActive !== null);
      field = 'categoryPaths'; const paths = parseCategoryPaths(read(mapping.categoryPaths));
      field = 'variantKey'; const key = importKey(read(mapping.variantKey)); field = 'variantName'; const variantName = importName(read(mapping.variantName));
      field = 'price'; const unitPriceRappen = parseImportPrice(read(mapping.price));
      field = 'sku'; const sku = normalizeSku(read(mapping.sku).trim() || null);
      if (sku !== null && /\p{Cf}/u.test(sku)) throw new DomainError('INVALID_SKU', 'SKU must not contain invisible formatting characters.');
      field = 'barcode'; const barcode = normalizeBarcode(read(mapping.barcode).trim() || null);
      if (barcode !== null && /\p{Cf}/u.test(barcode)) throw new DomainError('INVALID_BARCODE', 'Barcode must not contain invisible formatting characters.');
      field = 'variantActive'; const variantActive = importActive(read(mapping.variantActive), mapping.variantActive !== null);
      const prior = groups.get(productKey);
      if (prior && JSON.stringify({ name: prior.name, description: prior.description, active: prior.active, paths: prior.paths }) !== JSON.stringify({ name, description, active, paths })) {
        field = prior.name !== name ? 'productName' : prior.description !== description ? 'description' : prior.active !== active ? 'productActive' : 'categoryPaths';
        throw new DomainError('INCONSISTENT_PRODUCT', 'Repeated product name, description, active state and category paths must match across all variant rows.');
      }
      const candidate: ImportSourceVariant = { key, name: variantName, unitPriceRappen, sku, barcode, active: variantActive, position: prior?.variants.length ?? 0 };
      const serialized = JSON.stringify({ productKey, ...candidate, position: 0 });
      const duplicate = variants.get(key);
      if (duplicate !== undefined) {
        if (duplicate !== serialized) { field = 'variantKey'; throw new DomainError('DUPLICATE_VARIANT_KEY', 'Variant import keys must be globally unique; repeated variant definitions must match.'); }
        duplicateRows++; issues.push({ rowNumber: row.rowNumber, field: 'variantKey', code: 'DUPLICATE_SOURCE', message: 'An identical source variant row was skipped.', severity: 'warning' }); continue;
      }
      variants.set(key, serialized); rowsByVariant.set(key, row.rowNumber);
      groups.set(productKey, { key: productKey, name, description, active, paths, variants: [...(prior?.variants ?? []), candidate] });
    } catch (error) {
      issues.push({ rowNumber: row.rowNumber, field, code: error instanceof DomainError ? error.code : 'INVALID_ROW', message: error instanceof Error ? error.message : 'Invalid CSV row.', severity: 'error' });
    }
  }
  return { products: [...groups.values()], issues, duplicateRows, rowsByVariant };
}

/** Deterministic non-secret identity; any collision is checked against the full path. */
export function catalogImportId(prefix: string, key: string): string {
  let hash = 14695981039346656037n;
  for (const character of key) { hash ^= BigInt(character.codePointAt(0) ?? 0); hash = BigInt.asUintN(64, hash * 1099511628211n); }
  return `${prefix}-${hash.toString(16).padStart(16, '0')}`;
}
