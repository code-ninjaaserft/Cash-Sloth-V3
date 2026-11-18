import { describe, expect, it } from 'vitest';
import { MANAGEMENT_IPC_CONTRACTS, type ManagementMethod } from './management.js';

const mapping = { productKey: 0, productName: 1, variantKey: 2, variantName: 3, price: 4, description: null, sku: null, barcode: null, categoryPaths: null, productActive: null, variantActive: null };
const requests: Record<ManagementMethod, unknown> = { getCapabilities: {}, parseCsv: { text: 'a,b\n1,2', delimiter: 'auto' }, previewCsvImport: { text: 'a,b,c,d,e\nkey,name,v,Default,1.00', delimiter: ',', mapping }, previewDemoCatalog: {}, applyImportPlan: { planId: 'plan', idempotencyKey: 'key', operatorConfirmed: true }, getImportOperation: { idempotencyKey: 'key' } };

describe('management contracts', () => {
  it.each(Object.keys(requests) as ManagementMethod[])('%s accepts only its narrow operation envelope', (method) => {
    const contract = MANAGEMENT_IPC_CONTRACTS[method];
    expect(contract.request.safeParse(requests[method]).success).toBe(true);
    expect(contract.request.safeParse({ ...(requests[method] as object), sql: 'DELETE FROM products' }).success).toBe(false);
    expect(contract.request.safeParse(null).success).toBe(false);
  });
  it('requires explicit apply confirmation and rejects renderer-provided plans or filesystem paths', () => {
    expect(MANAGEMENT_IPC_CONTRACTS.applyImportPlan.request.safeParse({ planId: 'p', idempotencyKey: 'k', operatorConfirmed: false }).success).toBe(false);
    expect(MANAGEMENT_IPC_CONTRACTS.applyImportPlan.request.safeParse({ planId: 'p', idempotencyKey: 'k', operatorConfirmed: true, products: [] }).success).toBe(false);
    expect(MANAGEMENT_IPC_CONTRACTS.parseCsv.request.safeParse({ text: '', delimiter: 'auto', path: 'C:/private' }).success).toBe(false);
  });
  it('bounds CSV text and mapping indices and rejects unsupported delimiters', () => {
    expect(MANAGEMENT_IPC_CONTRACTS.parseCsv.request.safeParse({ text: 'x'.repeat(2_097_153), delimiter: 'auto' }).success).toBe(false);
    expect(MANAGEMENT_IPC_CONTRACTS.parseCsv.request.safeParse({ text: '', delimiter: '\t' }).success).toBe(false);
    expect(MANAGEMENT_IPC_CONTRACTS.previewCsvImport.request.safeParse({ text: '', delimiter: ',', mapping: { ...mapping, price: 64 } }).success).toBe(false);
  });
  it('allows nullable read-only recovery results without accepting fake success records', () => {
    expect(MANAGEMENT_IPC_CONTRACTS.getImportOperation.response.safeParse({ ok: true, value: null }).success).toBe(true);
    expect(MANAGEMENT_IPC_CONTRACTS.applyImportPlan.response.safeParse({ ok: true, value: { imported: 5 } }).success).toBe(false);
  });
});
