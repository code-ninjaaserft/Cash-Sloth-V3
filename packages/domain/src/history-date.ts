import { DomainError } from './models.js';

const swissClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function checkedDay(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day) || day < '1900-01-01' || day > '9999-01-01') throw new DomainError('INVALID_INPUT', 'History dates must be valid calendar dates from 1900 through 9998.');
  const milliseconds = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== day) throw new DomainError('INVALID_INPUT', 'Invalid history calendar date.');
  return milliseconds;
}

/** Resolve civil midnight using the named Swiss timezone, including DST.
 * The execution host's timezone never affects history filters. */
export function swissDayStartUtc(day: string): string {
  const target = checkedDay(day);
  let candidate = target;
  for (let iteration = 0; iteration < 4; iteration++) {
    const parts = Object.fromEntries(swissClock.formatToParts(candidate).map((part) => [part.type, part.value]));
    const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const next = target - (wall - candidate);
    if (next === candidate) return new Date(candidate).toISOString();
    candidate = next;
  }
  throw new DomainError('INVALID_INPUT', 'The Swiss history-day boundary could not be resolved.');
}

export function swissHistoryRange(dateFrom: string | null, dateTo: string | null): { fromInclusive: string | null; toExclusive: string | null } {
  if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) throw new DomainError('INVALID_INPUT', 'Start date must not follow end date.');
  const fromInclusive = dateFrom === null ? null : swissDayStartUtc(dateFrom);
  if (dateTo === null) return { fromInclusive, toExclusive: null };
  const nextDay = new Date(checkedDay(dateTo) + 86_400_000).toISOString().slice(0, 10);
  return { fromInclusive, toExclusive: swissDayStartUtc(nextDay) };
}
