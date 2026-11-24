import { addMoney, assertRappen } from './money.js';
import { DomainError } from './models.js';

export function customTip(baseRappen: number, amountRappen: number, mode: 'tip' | 'total', cash = false): { tipRappen: number; totalRappen: number } {
  assertRappen(baseRappen); assertRappen(amountRappen);
  if (mode !== 'tip' && mode !== 'total') throw new DomainError('INVALID_INPUT', 'Invalid tip entry mode.');
  const totalRappen = mode === 'total' ? amountRappen : addMoney(baseRappen, amountRappen);
  if (totalRappen < baseRappen) throw new DomainError('INVALID_INPUT', 'The total cannot be lower than the original amount.');
  const tipRappen = totalRappen - baseRappen;
  if (cash && (totalRappen % 5 !== 0 || tipRappen % 5 !== 0)) throw new DomainError('CASH_DENOMINATION', 'Use CHF 0.05 increments for cash.');
  return { tipRappen, totalRappen };
}

/** Strictly next CHF 5/10 boundary; exact multiples advance one interval. */
export function roundUpTip(baseRappen: number, stepRappen: 500 | 1000): { tipRappen: number; totalRappen: number } {
  assertRappen(baseRappen);
  if (stepRappen !== 500 && stepRappen !== 1000) throw new Error('Unsupported tip interval.');
  const tipRappen = stepRappen - baseRappen % stepRappen;
  return { tipRappen, totalRappen: addMoney(baseRappen, tipRappen) };
}
