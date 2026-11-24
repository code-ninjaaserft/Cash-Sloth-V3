import { describe, expect, it, vi } from 'vitest';
import { FILES_IPC_CONTRACTS, HISTORY_IPC_CONTRACTS, MANAGEMENT_IPC_CONTRACTS, type HistoryMethod, type ManagementMethod } from '@cash-sloth/contracts';
import { handleValidatedAsyncIpc, handleValidatedIpc, type RuntimeParser, type SenderIdentity } from './ipc-security.js';

const trusted: SenderIdentity = { webContentsId: 1, frameProcessId: 2, frameRoutingId: 3, url: 'file:///pos/index.html' };
const mapping = { productKey: 0, productName: 1, variantKey: 2, variantName: 3, price: 4, description: null, sku: null, barcode: null, categoryPaths: null, productActive: null, variantActive: null };
const managementRequests: Record<ManagementMethod, unknown> = {
  getCapabilities: {}, parseCsv: { text: 'key,name,variant,label,price\r\np,Product,v,Default,2.42', delimiter: 'auto' },
  previewCsvImport: { text: 'key,name,variant,label,price\r\np,Product,v,Default,2.42', delimiter: ',', mapping },
  previewDemoCatalog: {}, applyImportPlan: { planId: 'plan-security', idempotencyKey: 'operation-security', operatorConfirmed: true }, getImportOperation: { idempotencyKey: 'operation-security' },
};
const filters = { dateFrom: null, dateTo: null, paymentMethod: 'all', minTotalRappen: null, maxTotalRappen: null, refundStatus: 'all', saleId: '', productQuery: '' };
const sort = { field: 'date', direction: 'desc' };
const historyRequests: Record<HistoryMethod, unknown> = { previewRemoval: { scope: 'device', eventId: null }, removeHistory: { scope: 'device', eventId: null, operationId: 'purge-security', expectedVersion: 'a'.repeat(64), reason: 'Reset device history' }, getEvents: {}, removeSale: { saleId: 'sale-security', reason: 'Incorrect entry' }, search: { filters, sort, page: 1, pageSize: 25 }, getSaleContext: { saleId: 'sale-security' } };
const rejected = { ok: false, error: { code: 'TEST_FAILURE', message: 'No operation was executed.' } } as const;
const untrusted = [null, { ...trusted, webContentsId: 99 }, { ...trusted, frameProcessId: 99 }, { ...trusted, frameRoutingId: 99 }, { ...trusted, url: 'https://untrusted.invalid/' }];
type UnknownContract = { request: RuntimeParser<unknown>; response: RuntimeParser<unknown> };

describe.each([...Object.entries(MANAGEMENT_IPC_CONTRACTS), ...Object.entries(HISTORY_IPC_CONTRACTS)])('%s management/history IPC', (name, definition) => {
  const contract: UnknownContract = definition;
  const request = name in managementRequests ? managementRequests[name as ManagementMethod] : historyRequests[name as HistoryMethod];
  it('rejects unauthorized senders before any query or catalog operation', () => {
    for (const sender of untrusted) {
      const execute = vi.fn(() => rejected);
      expect(() => handleValidatedIpc(sender, trusted, [request], contract, execute)).toThrow('not authorized');
      expect(execute).not.toHaveBeenCalled();
    }
  });
  it('rejects extra authority and malformed argument envelopes', () => {
    for (const args of [[], [request, request], [null], [{ ...(request as object), sql: 'DELETE FROM sales', path: 'private.csv' }]]) {
      const execute = vi.fn(() => rejected);
      expect(() => handleValidatedIpc(trusted, trusted, args, contract, execute)).toThrow(); expect(execute).not.toHaveBeenCalled();
    }
  });
  it('accepts only runtime-validated responses', () => {
    expect(handleValidatedIpc(trusted, trusted, [request], contract, () => rejected)).toEqual(rejected);
    expect(() => handleValidatedIpc(trusted, trusted, [request], contract, () => ({ ok: true, value: 'invalid' }))).toThrow('Invalid IPC response');
  });
});

describe.each(Object.entries(FILES_IPC_CONTRACTS))('%s async native file IPC', (name, definition) => {
  const contract: UnknownContract = definition;
  const request = name === 'chooseCatalogCsv' ? {} : { filters, sort };
  it('authorizes the sender before any native dialog or file access', async () => {
    for (const sender of untrusted) {
      const execute = vi.fn(async () => rejected);
      await expect(handleValidatedAsyncIpc(sender, trusted, [request], contract, execute)).rejects.toThrow('not authorized'); expect(execute).not.toHaveBeenCalled();
    }
  });
  it('rejects renderer-supplied paths and malformed envelopes', async () => {
    for (const args of [[], [request, request], [null], [{ ...request, directory: 'C:\\private', path: '../secret.csv' }]]) {
      const execute = vi.fn(async () => rejected);
      await expect(handleValidatedAsyncIpc(trusted, trusted, args, contract, execute)).rejects.toThrow(); expect(execute).not.toHaveBeenCalled();
    }
  });
  it('awaits and validates the actual response rather than accepting a Promise as data', async () => {
    expect(await handleValidatedAsyncIpc(trusted, trusted, [request], contract, async () => rejected)).toEqual(rejected);
    await expect(handleValidatedAsyncIpc(trusted, trusted, [request], contract, async () => ({ ok: true, value: { path: 'arbitrary' } }))).rejects.toThrow('Invalid file IPC response');
  });
});

it('rejects unconfirmed imports, unsafe filters and out-of-bounds column maps before execution', () => {
  expect(MANAGEMENT_IPC_CONTRACTS.applyImportPlan.request.safeParse({ planId: 'plan', idempotencyKey: 'key', operatorConfirmed: false }).success).toBe(false);
  expect(MANAGEMENT_IPC_CONTRACTS.previewCsvImport.request.safeParse({ text: 'csv', delimiter: ',', mapping: { ...mapping, price: 64 } }).success).toBe(false);
  expect(HISTORY_IPC_CONTRACTS.search.request.safeParse({ filters: { ...filters, minTotalRappen: 0.01 }, sort, page: 1, pageSize: 25 }).success).toBe(false);
  expect(HISTORY_IPC_CONTRACTS.search.request.safeParse({ filters, sort: { field: 'sql', direction: 'desc' }, page: 1, pageSize: 25 }).success).toBe(false);
});
