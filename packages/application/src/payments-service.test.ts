import { describe, expect, it, vi } from 'vitest';
import { PAYMENTS_IPC_CONTRACTS, type PaymentsMethod } from '@cash-sloth/contracts';
import { DomainError } from '@cash-sloth/domain';
import type { FinanceStore } from './finance-ports.js';
import { createPaymentsService } from './payments-service.js';
import { PersistenceError } from './ports.js';

const runtime = { newId: () => 'host-id', now: () => '2026-11-16T12:00:00.000Z' };
describe('payment application boundary', () => {
  it.each(Object.keys(PAYMENTS_IPC_CONTRACTS) as PaymentsMethod[])('validates direct %s calls before any persistence access', (method) => {
    const access = vi.fn(() => { throw new Error('Persistence must not be reached for an invalid request.'); });
    const store = new Proxy({} as FinanceStore, { get: access });
    const result = createPaymentsService(store, runtime)[method]({ unrestricted: true } as never);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(access).not.toHaveBeenCalled();
  });
  it('distinguishes uncertain commits, known storage failure and financial conflicts without exposing diagnostics', () => {
    for (const [failure, expected] of [
      [new PersistenceError('unknown', 'SECRET diagnostic'), 'COMMIT_UNCERTAIN'],
      [new PersistenceError('rolled-back', 'SECRET diagnostic'), 'STORAGE_ERROR'],
      [new Error('SECRET diagnostic'), 'STORAGE_ERROR'],
      [new DomainError('CONFLICT', 'Review the original payment attempt.'), 'CONFLICT'],
    ] as const) {
      const store = { transaction: () => { throw failure; } } as unknown as FinanceStore;
      const result = createPaymentsService(store, runtime).getActiveCheckout({});
      expect(result).toMatchObject({ ok: false, error: { code: expected } });
      expect(JSON.stringify(result)).not.toContain('SECRET');
    }
  });
  it('fails closed when an adapter returns an invalid successful response', () => {
    const store = { transaction: (operation: () => unknown) => operation(), listFinancialSales: () => [{ id: 'corrupt-sale' }] } as unknown as FinanceStore;
    expect(createPaymentsService(store, runtime).listRecentSales({})).toMatchObject({ ok: false, error: { code: 'STORAGE_ERROR' } });
  });
});
