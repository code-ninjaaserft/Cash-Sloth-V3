import { describe, expect, it } from 'vitest';
import { POS_IPC_CONTRACTS, RappenSchema } from './pos.js';

describe('POS runtime contracts', () => {
  it('rejects extra fields and unsafe cash values before a privileged operation', () => {
    expect(POS_IPC_CONTRACTS.completeSale.request.safeParse({ idempotencyKey: 'checkout-1', cashReceivedRappen: 500, operatorConfirmed: true, sql: 'DROP TABLE sales' }).success).toBe(false);
    for (const amount of [-1, 2.5, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(RappenSchema.safeParse(amount).success).toBe(false);
    expect(POS_IPC_CONTRACTS.completeSale.request.safeParse({ idempotencyKey: 'checkout-1', cashReceivedRappen: 500, operatorConfirmed: false }).success).toBe(false);
  });
  it('keeps every request strict and every response discriminated', () => {
    for (const contract of Object.values(POS_IPC_CONTRACTS)) {
      expect(contract.request.safeParse({ unexpected: true }).success).toBe(false);
      expect(contract.response.safeParse({ ok: false, error: { code: 'CONFLICT', message: 'Refresh the cart.' } }).success).toBe(true);
      expect(contract.response.safeParse({ ok: true }).success).toBe(false);
      expect(contract.response.safeParse({ ok: false, error: { code: 'X', message: 'X', secret: 'X' } }).success).toBe(false);
    }
  });
});
