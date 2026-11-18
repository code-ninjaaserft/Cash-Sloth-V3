import { describe, expect, it } from 'vitest';
import { swissDayStartUtc, swissHistoryRange } from './history-date.js';

describe('Swiss history calendar boundaries', () => {
  it('uses explicit Swiss winter and summer offsets regardless of host timezone', () => {
    expect(swissDayStartUtc('2026-01-20')).toBe('2026-01-19T23:00:00.000Z');
    expect(swissDayStartUtc('2026-07-20')).toBe('2026-07-19T22:00:00.000Z');
  });
  it('includes the entire 23-hour spring clock-change day', () => {
    const result = swissHistoryRange('2026-03-29', '2026-03-29');
    expect(result).toEqual({ fromInclusive: '2026-03-28T23:00:00.000Z', toExclusive: '2026-03-29T22:00:00.000Z' });
    expect(Date.parse(result.toExclusive ?? '') - Date.parse(result.fromInclusive ?? '')).toBe(23 * 3600_000);
  });
  it('includes the entire 25-hour autumn clock-change day', () => {
    const result = swissHistoryRange('2026-10-25', '2026-10-25');
    expect(result).toEqual({ fromInclusive: '2026-10-24T22:00:00.000Z', toExclusive: '2026-10-25T23:00:00.000Z' });
    expect(Date.parse(result.toExclusive ?? '') - Date.parse(result.fromInclusive ?? '')).toBe(25 * 3600_000);
  });
  it('supports open endpoints, leap years and a maximum exclusive next-day boundary', () => {
    expect(swissHistoryRange(null, null)).toEqual({ fromInclusive: null, toExclusive: null });
    expect(swissHistoryRange('2024-02-29', null).fromInclusive).toBe('2024-02-28T23:00:00.000Z');
    expect(swissHistoryRange(null, '9998-12-31').toExclusive).toBe('9998-12-31T23:00:00.000Z');
  });
  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-1-1', '1899-12-31', '0000-01-01', 'not-a-date'])('rejects invalid or unsupported day %s', (day) => {
    expect(() => swissDayStartUtc(day)).toThrow();
  });
  it('rejects reversed day ranges', () => { expect(() => swissHistoryRange('2026-11-19', '2026-11-18')).toThrow('Start date'); });
});
