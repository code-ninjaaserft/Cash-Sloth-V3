import { CsvMappingSchema, type CsvMapping } from '@cash-sloth/contracts';

export type CsvMappingDraft = { [K in keyof CsvMapping]: number | null };
export const CSV_MAPPING_FIELDS: readonly { key: keyof CsvMapping; label: string; required: boolean; aliases: readonly string[] }[] = [
  { key: 'productKey', label: 'Product import key', required: true, aliases: ['productkey', 'productid', 'productidentifier'] },
  { key: 'productName', label: 'Product name', required: true, aliases: ['productname', 'product'] },
  { key: 'variantKey', label: 'Variant import key', required: true, aliases: ['variantkey', 'variantid', 'variantidentifier'] },
  { key: 'variantName', label: 'Variant name', required: true, aliases: ['variantname', 'variant'] },
  { key: 'price', label: 'Variant price', required: true, aliases: ['price', 'variantprice', 'pricechf', 'unitprice'] },
  { key: 'description', label: 'Product description', required: false, aliases: ['description', 'productdescription'] },
  { key: 'sku', label: 'SKU', required: false, aliases: ['sku'] },
  { key: 'barcode', label: 'Barcode', required: false, aliases: ['barcode'] },
  { key: 'categoryPaths', label: 'Category paths', required: false, aliases: ['categorypaths', 'categorypath', 'categories', 'category'] },
  { key: 'productActive', label: 'Product active', required: false, aliases: ['productactive'] },
  { key: 'variantActive', label: 'Variant active', required: false, aliases: ['variantactive', 'active'] },
];
const canonical = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, '');

/** Suggest only unique recognized headers; the operator still reviews each mapping. */
export function suggestCsvMapping(headers: readonly string[]): CsvMappingDraft {
  const normalized = headers.map(canonical);
  return Object.fromEntries(CSV_MAPPING_FIELDS.map((field) => {
    const matches = normalized.flatMap((header, index) => field.aliases.includes(header) ? [index] : []);
    return [field.key, matches.length === 1 ? matches[0] ?? null : null];
  })) as CsvMappingDraft;
}
export function completeCsvMapping(draft: CsvMappingDraft, columnCount: number): CsvMapping {
  for (const field of CSV_MAPPING_FIELDS) {
    const column = draft[field.key];
    if (column === null && field.required || column !== null && (!Number.isSafeInteger(column) || column < 0 || column >= columnCount)) throw new Error(`Choose a valid column for ${field.label}.`);
  }
  return CsvMappingSchema.parse(draft);
}
