import { describe, expect, it } from 'vitest';
import { catalogImportId, formatCategoryPath, mapCatalogCsv, parseCatalogCsv, parseCategoryPaths, parseImportPrice, type CsvMapping } from './catalog-import.js';

const mapping: CsvMapping = { productKey: 0, productName: 1, variantKey: 2, variantName: 3, price: 4, categoryPaths: 5, description: null, sku: null, barcode: null, productActive: null, variantActive: null };
const header = 'product_key;product_name;variant_key;variant_name;price;categories';

describe('strict bounded catalog CSV parser', () => {
  it('detects semicolon, UTF-8 BOM, quoted delimiters, escaped quotes and CRLF', () => {
    const parsed = parseCatalogCsv('\uFEFFkey;name;price\r\na;"Café; ""Alpine""";2,42\r\n', 'auto');
    expect(parsed).toMatchObject({ encoding: 'UTF-8 BOM', delimiter: ';', headers: ['key', 'name', 'price'], totalRows: 1 });
    expect(parsed.rows[0]).toEqual({ rowNumber: 2, values: ['a', 'Café; "Alpine"', '2,42'] });
  });
  it('handles quoted newlines and retains the next physical row number', () => {
    const parsed = parseCatalogCsv('key,name\na,"First\r\nSecond"\r\nb,Last', ',');
    expect(parsed.rows).toEqual([{ rowNumber: 2, values: ['a', 'First\nSecond'] }, { rowNumber: 4, values: ['b', 'Last'] }]);
  });
  it('supports comma CSV and ignores truly blank records without shifting source line numbers', () => {
    expect(parseCatalogCsv('key,name\n\na,Apple\n', 'auto').rows).toEqual([{ rowNumber: 3, values: ['a', 'Apple'] }]);
  });
  it('requires an explicit choice when both separators are plausible', () => {
    const text = 'a,b;c\n1,2;3';
    expect(() => parseCatalogCsv(text, 'auto')).toThrow('Both comma and semicolon');
    expect(parseCatalogCsv(text, ';').rows[0]?.values).toEqual(['1,2', '3']);
  });
  it.each(['a,b\n1,"broken', 'a,b\n1,x"y', 'a,b\n1,"two"junk', 'a,b\n1,2,3', 'a,a\n1,2', ',name\n1,2', '', 'header', 'a,b\n1,\u0000', 'a,b\n1,\uD800'])('rejects malformed or unsupported text %j', (text) => {
    expect(() => parseCatalogCsv(text, ',')).toThrow();
  });
  it('rejects oversize fields, column counts, byte sizes and row counts', () => {
    expect(() => parseCatalogCsv(`a,b\n1,${'x'.repeat(4001)}`, ',')).toThrow('4000');
    expect(() => parseCatalogCsv(Array.from({ length: 65 }, (_, index) => `h${index}`).join(','), ',')).toThrow('64 columns');
    expect(() => parseCatalogCsv('ä'.repeat(1_048_577), ',')).toThrow('2 MiB');
    expect(() => parseCatalogCsv(`a,b\n${'1,2\n'.repeat(10_001)}`, ',')).toThrow('10000');
  });
  it('accepts an empty dataset with a valid header without inventing rows', () => {
    expect(parseCatalogCsv('a,b\n', ',').totalRows).toBe(0);
  });
});

describe('explicit CHF parsing and category grammar', () => {
  it.each([['0', 0], ['2.42', 242], ['3,47', 347], ["1'234.50", 123450], ['12’345,67', 1234567], ['0002.4', 240], ['90071992547409.91', Number.MAX_SAFE_INTEGER]])('parses %s into exact integer Rappen', (input, expected) => {
    expect(parseImportPrice(String(input))).toBe(expected);
  });
  it.each(['', '-1', '+1', '2.345', '1,234', '1,234.50', '1.234,50', 'CHF 2.42', 'Infinity', 'NaN', "12'34.50", "1'000'00", '90071992547409.92'])('rejects missing, ambiguous or unsafe price %j', (input) => {
    expect(() => parseImportPrice(input)).toThrow();
  });
  it('normalizes hierarchy and preserves escaped literal separators and backslashes', () => {
    const parsed = parseCategoryPaths(' Drinks > Still\\>Water | Food > Salt\\|Sweet > Folder\\\\Name ');
    expect(parsed).toEqual([['Drinks', 'Still>Water'], ['Food', 'Salt|Sweet', 'Folder\\Name']]);
    expect(parseCategoryPaths(parsed.map(formatCategoryPath).join(' | '))).toEqual(parsed);
    expect(parseCategoryPaths('A > B | A>B')).toEqual([['A', 'B']]);
  });
  it.each(['A >> B', 'A |', '> B', 'A\\x', 'A\\', Array.from({ length: 65 }, () => 'A').join('>')])('rejects malformed category paths %j', (text) => {
    expect(() => parseCategoryPaths(text)).toThrow();
  });
  it('gives deterministic namespaced identities for Unicode paths', () => {
    expect(catalogImportId('csv-c', '["Sören","Sweet"]')).toBe(catalogImportId('csv-c', '["Sören","Sweet"]'));
    expect(catalogImportId('csv-c', 'one')).not.toBe(catalogImportId('csv-c', 'two'));
  });
});

describe('catalog row grouping and validation', () => {
  it('groups variants by product key and normalizes repeated category definitions', () => {
    const mapped = mapCatalogCsv(parseCatalogCsv(`${header}\nwater;Mineral Water;water-s;Small;2.42;Drinks > Water\nwater;Mineral Water;water-l;Large;3,47;Drinks>Water`, ';'), mapping);
    expect(mapped.issues).toEqual([]); expect(mapped.products).toHaveLength(1);
    expect(mapped.products[0]?.variants.map((variant) => variant.unitPriceRappen)).toEqual([242, 347]);
  });
  it('reports inconsistent repeated product fields rather than choosing a row', () => {
    const mapped = mapCatalogCsv(parseCatalogCsv(`${header}\na;First;a1;Small;1.00;Food\na;Different;a2;Large;2.00;Food`, ';'), mapping);
    expect(mapped.issues).toMatchObject([{ rowNumber: 3, code: 'INCONSISTENT_PRODUCT', severity: 'error' }]);
  });
  it('distinguishes identical duplicate rows from conflicting variant identities', () => {
    const text = `${header}\na;First;a1;Small;1.00;Food\na;First;a1;Small;1.00;Food\nb;Second;a1;Other;2.00;Food`;
    const mapped = mapCatalogCsv(parseCatalogCsv(text, ';'), mapping);
    expect(mapped.duplicateRows).toBe(1); expect(mapped.issues.map((issue) => issue.code)).toEqual(['DUPLICATE_SOURCE', 'DUPLICATE_VARIANT_KEY']);
  });
  it('provides a physical row number and price field for invalid currency', () => {
    const mapped = mapCatalogCsv(parseCatalogCsv(`${header}\na;First;a1;Small;-1.00;Food`, ';'), mapping);
    expect(mapped.issues).toMatchObject([{ rowNumber: 2, field: 'price', severity: 'error' }]);
  });
  it('rejects mapped nonexistent columns and unsafe identifiers', () => {
    const doc = parseCatalogCsv(`${header}\n../bad;First;a1;Small;1.00;Food`, ';');
    expect(mapCatalogCsv(doc, mapping).issues[0]?.field).toBe('productKey');
    expect(() => mapCatalogCsv(doc, { ...mapping, price: 63 })).toThrow('Mapped column');
  });
  it('supports optional metadata and explicit inactive states', () => {
    const text = 'pk;pn;vk;vn;p;cat;pa;va;sku;barcode\na;First;a1;Default;0;Food;false;0;  abc  ;TEST-FAKE';
    const result = mapCatalogCsv(parseCatalogCsv(text, ';'), { ...mapping, productActive: 6, variantActive: 7, sku: 8, barcode: 9 });
    expect(result.issues).toEqual([]); expect(result.products[0]).toMatchObject({ active: false, variants: [{ active: false, sku: 'ABC', barcode: 'TEST-FAKE' }] });
  });
});
