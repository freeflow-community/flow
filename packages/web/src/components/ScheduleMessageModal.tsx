// Create / edit a scheduled message (#420). One dialog, reached two ways: the
// Scheduled panel's "New scheduled message", and the composer's clock (which
// prefills the destination and whatever is already typed).
//
// The schedule controls are presets rather than a cron box because that is what
// people actually want — "daily at 9", "every 12 hours" — and because the
// server stores the preset structurally, so reopening this dialog puts the same
// dropdowns back rather than showing a compiled cron string. Cron is still
// there as the advanced escape hatch.
import { useMemo, useState } from 'react';
import type { ChannelDTO, Recurrence, ScheduledMessageDTO } from '@flow/shared';
import { ApiError } from '../lib/api';
import { isSelfDm } from '../lib/channelTitle';
import { useAuth } from '../state';
import { useChannels, useScheduledMessageActions } from '../hooks';
import { Modal } from './modals';

type PresetKind = Recurrence['type'];

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EVERY_N_CHOICES = [2, 3, 4, 6, 8, 12];

/** The browser's own zone — the one the user means when they type "9:00". */
const localTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const pad = (n: number): string => String(n).padStart(2, '0');

/** `<input type="datetime-local">` wants local wall-clock text, not an ISO instant. */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Today at `HH:MM` local, rolled to tomorrow if that has already passed —
 * what "starting 6:00 AM" means for an every-N-hours anchor. */
function nextLocalTime(hour: number, minute: number): Date {
  const at = new Date();
  at.setHours(hour, minute, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  return at;
}

interface FormState {
  kind: PresetKind;
  onceAt: string; // datetime-local
  timeOfDay: string; // HH:MM, used by daily / weekly / everyNHours
  minute: number; // hourly
  weekday: number;
  everyHours: number;
  cron: string;
}

function initialForm(existing?: ScheduledMessageDTO): FormState {
  const base: FormState = {
    kind: 'daily',
    onceAt: toLocalInput(new Date(Date.now() + 60 * 60 * 1000)),
    timeOfDay: '09:00',
    minute: 0,
    weekday: 1,
    everyHours: 12,
    cron: '0 9 * * 1-5',
  };
  const r = existing?.recurrence;
  if (!r) return base;
  switch (r.type) {
    case 'once':
      return { ...base, kind: 'once', onceAt: toLocalInput(new Date(r.at)) };
    case 'hourly':
      return { ...base, kind: 'hourly', minute: r.minute };
    case 'everyNHours': {
      const anchor = new Date(r.anchor);
      return {
        ...base,
        kind: 'everyNHours',
        everyHours: r.hours,
        timeOfDay: `${pad(anchor.getHours())}:${pad(anchor.getMinutes())}`,
      };
    }
    case 'daily':
      return { ...base, kind: 'daily', timeOfDay: `${pad(r.hour)}:${pad(r.minute)}` };
    case 'weekly':
      return { ...base, kind: 'weekly', weekday: r.weekday, timeOfDay: `${pad(r.hour)}:${pad(r.minute)}` };
    case 'cron':
      return { ...base, kind: 'cron', cron: r.expression };
  }
}

/** Form → the wire shape. Throws a plain Error for the one thing the controls
 * can't prevent: a "once" date in the past. */
export function buildRecurrence(form: FormState): Recurrence {
  const [h, m] = form.timeOfDay.split(':').map(Number);
  const hour = h ?? 9;
  const minute = m ?? 0;
  switch (form.kind) {
    case 'once': {
      const at = new Date(form.onceAt);
      if (Number.isNaN(at.getTime())) throw new Error('Pick a date and time');
      if (at.getTime() <= Date.now()) throw new Error('Pick a time in the future');
      return { type: 'once', at: at.toISOString() };
    }
    case 'hourly':
      return { type: 'hourly', minute: form.minute };
    case 'everyNHours':
      return { type: 'everyNHours', hours: form.everyHours, anchor: nextLocalTime(hour, minute).toISOString() };
    case 'daily':
      return { type: 'daily', hour, minute };
    case 'weekly':
      return { type: 'weekly', weekday: form.weekday, hour, minute };
    case 'cron':
      return { type: 'cron', expression: form.cron.trim() };
  }
}

export function ScheduleMessageModal({
  workspaceId,
  existing,
  initialBody,
  initialChannelId,
  onSaved,
  onClose,
}: {
  workspaceId: string;
  /** Editing an existing row; absent means "new". */
  existing?: ScheduledMessageDTO;
  /** Composer hand-off: whatever was already typed. */
  initialBody?: string;
  /** Composer hand-off: the conversation it was typed in. */
  initialChannelId?: string;
  /** Fired after a successful save — the composer clears its draft on it. */
  onSaved?: () => void;
  onClose: () => void;
}) {
  const auth = useAuth();
  const channels = useChannels(workspaceId);
  const { create, update } = useScheduledMessageActions();
  const [body, setBody] = useState(existing?.body ?? initialBody ?? '');
  const [form, setForm] = useState<FormState>(() => initialForm(existing));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // Destinations: your "Just me" conversation first, then every channel you're
  // in. Group DMs are deliberately absent — a scheduled message posts as you,
  // and the two destinations that reads sensibly in are your own notes and a
  // channel you're a member of.
  const selfDm = (channels.data ?? []).find((c) => isSelfDm(c, auth.user.id));
  const joined = useMemo(
    () =>
      (channels.data ?? [])
        .filter((c) => c.isMember && c.kind === 'standard' && !c.archivedAt)
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [channels.data],
  );
  const [channelId, setChannelId] = useState(
    existing?.channelId ?? initialChannelId ?? selfDm?.id ?? joined[0]?.id ?? '',
  );
  // The channel list can arrive after the first render; adopt a default then.
  const destination = channelId || selfDm?.id || joined[0]?.id || '';

  const timezone = localTimezone();
  const saving = create.isPending || update.isPending;

  const submit = async () => {
    setError(null);
    if (!body.trim()) return setError('Write the message you want posted');
    if (!destination) return setError('Pick where it should post');
    let recurrence: Recurrence;
    try {
      recurrence = buildRecurrence(form);
    } catch (err) {
      return setError(err instanceof Error ? err.message : 'Invalid schedule');
    }
    try {
      if (existing) {
        await update.mutateAsync({ id: existing.id, channelId: destination, body, recurrence, timezone });
      } else {
        await create.mutateAsync({ channelId: destination, body, recurrence, timezone });
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this scheduled message');
    }
  };

  return (
    <Modal onClose={onClose} testid="schedule-message-modal" wide>
      <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
        <span aria-hidden>🕐</span>
        {existing ? 'Edit scheduled message' : 'New scheduled message'}
      </h3>

      <label className="mb-1 block text-xs font-bold text-ink-soft">Schedule</label>
      <div className="mb-1 flex flex-wrap gap-2">
        <select
          data-testid="schedule-kind"
          className="rounded-lg border border-hairline2 px-3 py-2 text-sm"
          value={form.kind}
          onChange={(e) => set({ kind: e.target.value as PresetKind })}
        >
          <option value="once">Once</option>
          <option value="hourly">Hourly</option>
          <option value="everyNHours">Every N hours</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="cron">Custom cron…</option>
        </select>

        {form.kind === 'once' && (
          <input
            data-testid="schedule-once-at"
            type="datetime-local"
            className="rounded-lg border border-hairline2 px-3 py-2 text-sm"
            value={form.onceAt}
            onChange={(e) => set({ onceAt: e.target.value })}
          />
        )}
        {form.kind === 'hourly' && (
          <select
            data-testid="schedule-minute"
            className="rounded-lg border border-hairline2 px-3 py-2 text-sm"
            value={form.minute}
            onChange={(e) => set({ minute: Number(e.target.value) })}
          >
            {[0, 15, 30, 45].map((m) => (
              <option key={m} value={m}>at :{pad(m)}</option>
            ))}
          </select>
        )}
        {form.kind === 'everyNHours' && (
          <>
            <select
              data-testid="schedule-every-hours"
              className="rounded-lg border border-hairline2 px-3 py-2 text-sm"
              value={form.everyHours}
              onChange={(e) => set({ everyHours: Number(e.target.value) })}
            >
              {EVERY_N_CHOICES.map((n) => (
                <option key={n} value={n}>every {n} hours</option>
              ))}
            </select>
            <input
              data-testid="schedule-time"
              type="time"
              className="rounded-lg border border-hairline2 px-3 py-2 text-sm"
              value={form.timeOfDay}
              onChange={(e) => set({ timeOfDay: e.target.value })}
            />
          </>
        )}
        {form.kind === 'weekly' && (
          <select
            data-testid="schedule-weekday"
            className="rounded-lg border border-hairline2 px-3 py-2 text-sm"
            value={form.weekday}
            onChange={(e) => set({ weekday: Number(e.target.value) })}
          >
            {WEEKDAY_NAMES.map((name, i) => (
              <option key={name} value={i}>{name}</option>
            ))}
          </select>
        )}
        {(form.kind === 'daily' || form.kind === 'weekly') && (
          <input
            data-testid="schedule-time"
            type="time"
            className="rounded-lg border border-hairline2 px-3 py-2 text-sm"
            value={form.timeOfDay}
            onChange={(e) => set({ timeOfDay: e.target.value })}
          />
        )}
        {form.kind === 'cron' && (
          <input
            data-testid="schedule-cron"
            className="min-w-[200px] flex-1 rounded-lg border border-hairline2 px-3 py-2 font-mono text-sm"
            placeholder="min hour dom mon dow"
            value={form.cron}
            onChange={(e) => set({ cron: e.target.value })}
          />
        )}
      </div>
      <p className="mb-4 text-xs text-muted">
        Runs in your timezone ({timezone}).
        {form.kind !== 'cron' && ' Switch to cron for advanced schedules.'}
      </p>

      <label className="mb-1 block text-xs font-bold text-ink-soft" htmlFor="schedule-body">
        Message to post
      </label>
      <textarea
        id="schedule-body"
        data-testid="schedule-body"
        className="mb-4 h-24 w-full resize-y rounded-lg border border-hairline2 px-3 py-2 text-sm"
        placeholder="What should Flow post?"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      <label className="mb-1 block text-xs font-bold text-ink-soft">Post to</label>
      <div
        data-testid="schedule-destinations"
        className="mb-2 max-h-48 overflow-y-auto rounded-lg border border-hairline2"
      >
        {selfDm && (
          <DestinationRow
            channel={selfDm}
            label="🔒 Just me"
            tag="Personal"
            selected={destination === selfDm.id}
            onSelect={() => setChannelId(selfDm.id)}
          />
        )}
        {joined.map((c) => (
          <DestinationRow
            key={c.id}
            channel={c}
            label={`# ${c.name ?? ''}`}
            tag="Shared"
            selected={destination === c.id}
            onSelect={() => setChannelId(c.id)}
          />
        ))}
      </div>
      <p className="mb-4 text-xs text-muted">
        Posting to a channel makes this scheduled message visible to all of its members. It posts as{' '}
        <strong>you</strong>, marked as scheduled.
      </p>

      {error && <p className="mb-3 text-sm text-red-600" data-testid="schedule-error">{error}</p>}

      <div className="flex justify-end gap-2">
        <button className="rounded-lg px-4 py-2 text-sm font-semibold text-accent-soft" onClick={onClose}>
          Cancel
        </button>
        <button
          data-testid="schedule-save"
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          onClick={() => void submit()}
        >
          {existing ? 'Save changes' : 'Schedule it'}
        </button>
      </div>
    </Modal>
  );
}

function DestinationRow({
  channel,
  label,
  tag,
  selected,
  onSelect,
}: {
  channel: ChannelDTO;
  label: string;
  tag: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`schedule-destination-${channel.id}`}
      aria-pressed={selected}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
        selected ? 'bg-accent/10 font-semibold text-accent-soft' : 'hover:bg-daypill/50'
      }`}
      onClick={onSelect}
    >
      <span
        aria-hidden
        className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
          selected ? 'border-accent bg-accent' : 'border-hairline2'
        }`}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 rounded bg-daypill px-1.5 py-0.5 text-[10px] font-semibold text-muted">{tag}</span>
    </button>
  );
}
