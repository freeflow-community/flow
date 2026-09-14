// Next-occurrence computation for scheduled messages (#419). Pure functions, no
// database — the point of these is the timezone arithmetic, which is where a
// scheduler quietly goes wrong (a daily 9 AM message drifting to 8 AM in
// November is exactly the bug this file exists to prevent).
import { describe, expect, it } from 'vitest';
import { localParts, nextOccurrence, parseCron, isValidTimezone } from '../src/lib/recurrence.js';

const NY = 'America/New_York';
const UTC = 'UTC';

/** The wall-clock reading of an instant in a zone, as "YYYY-MM-DD HH:MM". */
function reads(instant: Date, tz: string): string {
  const p = localParts(instant, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

describe('timezone plumbing', () => {
  it('knows real zones and rejects invented ones', () => {
    expect(isValidTimezone(NY)).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });

  it('reads an instant in the requested zone, including across midnight', () => {
    // 2026-01-15T02:30Z is still the 14th in New York.
    expect(reads(new Date('2026-01-15T02:30:00Z'), NY)).toBe('2026-01-14 21:30');
    expect(reads(new Date('2026-01-15T02:30:00Z'), UTC)).toBe('2026-01-15 02:30');
  });
});

describe('daily', () => {
  const daily9 = { type: 'daily', hour: 9, minute: 0 } as const;

  it('picks today when 9 AM is still ahead, tomorrow once it has passed', () => {
    const before = nextOccurrence(daily9, NY, new Date('2026-01-15T12:00:00Z')); // 07:00 NY
    expect(reads(before!, NY)).toBe('2026-01-15 09:00');

    const after = nextOccurrence(daily9, NY, new Date('2026-01-15T16:00:00Z')); // 11:00 NY
    expect(reads(after!, NY)).toBe('2026-01-16 09:00');
  });

  it('stays at 9 AM local across a DST change — the absolute instant moves, the wall clock does not', () => {
    // US DST ends 2026-11-01. The last run before it and the first after it are
    // 25 hours apart in absolute terms, and both read 09:00.
    const before = nextOccurrence(daily9, NY, new Date('2026-10-31T12:00:00Z'))!;
    const after = nextOccurrence(daily9, NY, before)!;
    expect(reads(before, NY)).toBe('2026-10-31 09:00');
    expect(reads(after, NY)).toBe('2026-11-01 09:00');
    expect(after.getTime() - before.getTime()).toBe(25 * 3_600_000);
  });

  it('a time inside the spring-forward gap fires just after the jump', () => {
    // 2026-03-08: 2:00–3:00 AM does not exist in New York.
    const at230 = { type: 'daily', hour: 2, minute: 30 } as const;
    const next = nextOccurrence(at230, NY, new Date('2026-03-08T04:00:00Z'))!; // 23:00 NY on the 7th
    expect(reads(next, NY)).toBe('2026-03-08 03:30');
  });
});

describe('weekly', () => {
  it('lands on the requested weekday at the requested local time', () => {
    const mon930 = { type: 'weekly', weekday: 1, hour: 9, minute: 30 } as const;
    const next = nextOccurrence(mon930, NY, new Date('2026-01-15T16:00:00Z'))!; // Thursday
    expect(reads(next, NY)).toBe('2026-01-19 09:30'); // the following Monday
    expect(localParts(next, NY).weekday).toBe(1);
  });
});

describe('hourly and every-N-hours', () => {
  it('hourly fires at the requested minute of the next hour', () => {
    const at15 = { type: 'hourly', minute: 15 } as const;
    expect(reads(nextOccurrence(at15, UTC, new Date('2026-01-15T10:20:00Z'))!, UTC)).toBe('2026-01-15 11:15');
    expect(reads(nextOccurrence(at15, UTC, new Date('2026-01-15T10:10:00Z'))!, UTC)).toBe('2026-01-15 10:15');
  });

  it('every-12-hours keeps an exact 12h spacing from its anchor', () => {
    const rule = { type: 'everyNHours', hours: 12, anchor: '2026-01-15T06:00:00.000Z' } as const;
    const first = nextOccurrence(rule, NY, new Date('2026-01-15T05:00:00Z'))!;
    expect(first.toISOString()).toBe('2026-01-15T06:00:00.000Z');
    const second = nextOccurrence(rule, NY, first)!;
    expect(second.toISOString()).toBe('2026-01-15T18:00:00.000Z');
    // Far in the future, still on the grid — no accumulated drift.
    const later = nextOccurrence(rule, NY, new Date('2026-03-20T07:00:00Z'))!;
    expect((later.getTime() - Date.parse(rule.anchor)) % (12 * 3_600_000)).toBe(0);
  });
});

describe('once', () => {
  it('returns the instant while it is ahead and null once it is past', () => {
    const rule = { type: 'once', at: '2026-01-15T09:00:00.000Z' } as const;
    expect(nextOccurrence(rule, UTC, new Date('2026-01-15T08:00:00Z'))!.toISOString()).toBe(rule.at);
    expect(nextOccurrence(rule, UTC, new Date('2026-01-15T09:00:00Z'))).toBeNull();
    expect(nextOccurrence(rule, UTC, new Date('2026-02-01T00:00:00Z'))).toBeNull();
  });
});

describe('cron', () => {
  it('parses fields, ranges, lists and steps', () => {
    expect(parseCron('*/15 * * * *').minutes).toEqual([0, 15, 30, 45]);
    expect(parseCron('0 9-11 * * *').hours).toEqual([9, 10, 11]);
    expect(parseCron('0 0 1,15 * *').daysOfMonth).toEqual([1, 15]);
    expect(parseCron('0 0 * * 7').daysOfWeek).toEqual([0]); // 7 is Sunday too
    expect(parseCron('0 0 * * *').daysOfWeek).toBeNull();
    expect(() => parseCron('0 0 * *')).toThrow(/5 fields/);
    expect(() => parseCron('99 0 * * *')).toThrow(/bad cron/);
  });

  it('computes the next match in the row timezone', () => {
    const rule = { type: 'cron', expression: '30 8 * * 1' } as const; // Mondays 08:30
    const next = nextOccurrence(rule, NY, new Date('2026-01-15T16:00:00Z'))!;
    expect(reads(next, NY)).toBe('2026-01-19 08:30');
  });

  it('is strictly after — a rule matching *now* yields the following slot', () => {
    const rule = { type: 'cron', expression: '0 * * * *' } as const;
    const next = nextOccurrence(rule, UTC, new Date('2026-01-15T10:00:00Z'))!;
    expect(reads(next, UTC)).toBe('2026-01-15 11:00');
  });

  it('returns null for a rule that can never match', () => {
    expect(nextOccurrence({ type: 'cron', expression: '0 0 30 2 *' }, UTC, new Date())).toBeNull();
  });
});
