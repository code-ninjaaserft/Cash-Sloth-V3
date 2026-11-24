import { describe, expect, it } from 'vitest';
import { customTip, roundUpTip } from './tips.js';

describe('tip round-up options in integer Rappen', () => {
  it.each([[2350, 500, 150, 2500], [2350, 1000, 650, 3000], [2500, 500, 500, 3000], [3000, 1000, 1000, 4000], [247, 500, 253, 500]] as const)('rounds %i by %i to the next boundary', (base, step, tip, total) => {
    expect(roundUpTip(base, step)).toEqual({ tipRappen: tip, totalRappen: total });
  });
  it('rejects invalid or overflowing amounts', () => {
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER]) expect(() => roundUpTip(value, 500)).toThrow();
  });
  it('accepts an additional tip or a desired total without compounding earlier tips', () => {
    expect(customTip(2350, 125, 'tip')).toEqual({ tipRappen: 125, totalRappen: 2475 });
    expect(customTip(2350, 2700, 'total')).toEqual({ tipRappen: 350, totalRappen: 2700 });
    expect(customTip(2350, 2350, 'total')).toEqual({ tipRappen: 0, totalRappen: 2350 });
    expect(customTip(247, 123, 'tip')).toEqual({ tipRappen: 123, totalRappen: 370 });
  });
  it('rejects lower targets, overflow, negative amounts and unsupported cash denominations', () => {
    expect(() => customTip(2350, 2300, 'total')).toThrow('lower');
    expect(() => customTip(2350, -1, 'tip')).toThrow();
    expect(() => customTip(Number.MAX_SAFE_INTEGER, 1, 'tip')).toThrow();
    expect(() => customTip(245, 123, 'tip', true)).toThrow('0.05');
    expect(() => customTip(245, 427, 'total', true)).toThrow('0.05');
    expect(customTip(245, 425, 'total', true)).toEqual({ tipRappen: 180, totalRappen: 425 });
  });
});
