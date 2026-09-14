import { describe, expect, it } from 'vitest';
import type { ScheduledMessageDTO } from '@flow/shared';
import { describeRecurrence } from '@flow/shared';
import { statusOf } from './ScheduledView';
import { buildRecurrence } from './ScheduleMessageModal';

const row = (over: Partial<ScheduledMessageDTO> = {}): ScheduledMessageDTO => ({
  id: 's1',
  workspaceId: 'w1',
  channelId: 'c1',
  authorUserId: 'u1',
  body: 'standup in 5',
  recurrence: { type: 'daily', hour: 9, minute: 0 },
  timezone: 'UTC',
  nextRunAt: '2026-01-16T09:00:00.000Z',
  enabled: true,
  lastRunAt: null,
  lastRunStatus: null,
  lastMessageId: null,
  lastError: null,
  createdAt: '2026-01-15T09:00:00.000Z',
  updatedAt: '2026-01-15T09:00:00.000Z',
  canManage: true,
  ...over,
});

// The pill is the only thing on the row that says whether automation is
// actually working, so its precedence matters: a row the server stopped for
// itself reads "Failed", while one a person paused reads "Paused" — and
// `lastError` (set by the server, cleared by a manual pause) is the difference.
describe('statusOf', () => {
  it('reports a never-run row as Scheduled', () => {
    expect(statusOf(row(), false).label).toBe('Scheduled');
  });

  it('reports the last run outcome', () => {
    expect(statusOf(row({ lastRunStatus: 'ok', lastRunAt: '2026-01-15T09:00:00.000Z' }), false).label)
      .toBe('✓ Succeeded');
    expect(statusOf(row({ lastRunStatus: 'failed', enabled: false, lastError: 'author left' }), false).label)
      .toBe('✗ Failed');
  });

  it('says Failed when the server stopped the row, Paused when a person did', () => {
    const safetyPaused = row({ enabled: false, lastRunStatus: 'failed', lastError: 'you are no longer a member' });
    expect(statusOf(safetyPaused, false).label).toBe('✗ Failed');
    // the same row after someone pauses it by hand — the server clears lastError
    expect(statusOf({ ...safetyPaused, lastError: null }, false).label).toBe('⏸ Paused');
    expect(statusOf(row({ enabled: false, lastRunStatus: 'ok' }), false).label).toBe('⏸ Paused');
  });

  it('lets Running win over everything', () => {
    expect(statusOf(row({ enabled: false, lastRunStatus: 'failed', lastError: 'x' }), true).label)
      .toBe('● Running');
  });
});

describe('describeRecurrence', () => {
  it('says schedules the way a person would', () => {
    expect(describeRecurrence({ type: 'daily', hour: 9, minute: 0 })).toBe('Daily at 9:00 AM');
    expect(describeRecurrence({ type: 'weekly', weekday: 1, hour: 9, minute: 30 })).toBe('Weekly, Mon 9:30 AM');
    expect(describeRecurrence({ type: 'everyNHours', hours: 12, anchor: '2026-01-15T06:00:00.000Z' }))
      .toBe('Every 12 hours');
    expect(describeRecurrence({ type: 'hourly', minute: 0 })).toBe('Hourly, on the hour');
    expect(describeRecurrence({ type: 'hourly', minute: 30 })).toBe('Hourly, at :30');
    expect(describeRecurrence({ type: 'cron', expression: '0 9 * * 1-5' })).toBe('Cron: 0 9 * * 1-5');
  });

  it('handles noon and midnight without saying 0:00', () => {
    expect(describeRecurrence({ type: 'daily', hour: 0, minute: 0 })).toBe('Daily at 12:00 AM');
    expect(describeRecurrence({ type: 'daily', hour: 12, minute: 0 })).toBe('Daily at 12:00 PM');
  });
});

// The form's job is to turn dropdowns into the wire shape the server validates.
const form = {
  kind: 'daily' as const,
  onceAt: '',
  timeOfDay: '09:30',
  minute: 0,
  weekday: 1,
  everyHours: 12,
  cron: '0 9 * * 1-5',
};

describe('buildRecurrence', () => {
  it('builds each preset from the same form state', () => {
    expect(buildRecurrence(form)).toEqual({ type: 'daily', hour: 9, minute: 30 });
    expect(buildRecurrence({ ...form, kind: 'weekly' })).toEqual({
      type: 'weekly', weekday: 1, hour: 9, minute: 30,
    });
    expect(buildRecurrence({ ...form, kind: 'hourly', minute: 15 })).toEqual({ type: 'hourly', minute: 15 });
    expect(buildRecurrence({ ...form, kind: 'cron' })).toEqual({ type: 'cron', expression: '0 9 * * 1-5' });
  });

  it('anchors every-N-hours to a future instant', () => {
    const r = buildRecurrence({ ...form, kind: 'everyNHours' });
    expect(r.type).toBe('everyNHours');
    if (r.type !== 'everyNHours') return;
    expect(r.hours).toBe(12);
    expect(Date.parse(r.anchor)).toBeGreaterThan(Date.now());
  });

  it('refuses a one-shot in the past', () => {
    const past = new Date(Date.now() - 60_000);
    const local = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}T${String(past.getHours()).padStart(2, '0')}:${String(past.getMinutes()).padStart(2, '0')}`;
    expect(() => buildRecurrence({ ...form, kind: 'once', onceAt: local })).toThrow(/future/i);
  });
});
