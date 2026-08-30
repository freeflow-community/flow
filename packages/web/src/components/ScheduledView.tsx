// The Scheduled panel (#420) — a virtual, always-present per-workspace view
// behind the clock next to the Activity bell, in the same "sentinel channel id"
// shape as the Activity feed.
//
// One list, not tabs: the server already decides what you may see (your own
// rows plus rows destined for channels you're in), so a personal/shared split
// would be re-explaining the same fact twice. "Owned by me" is the one filter
// that narrows to a genuinely different question.
import { useState } from 'react';
import type { ScheduledMessageDTO } from '@flow/shared';
import { describeRecurrence } from '@flow/shared';
import { displayTime, plainBody } from '../lib/format';
import { isSelfDm } from '../lib/channelTitle';
import { useAuth, useSelection } from '../state';
import { useChannels, useMemberMap, useNameMap, useScheduledMessageActions, useScheduledMessages } from '../hooks';
import { Avatar } from './Avatar';
import { MobileMenuButton } from './MobileMenuButton';
import { ScheduleMessageModal } from './ScheduleMessageModal';

export default function ScheduledView() {
  const sel = useSelection();
  const auth = useAuth();
  const [mine, setMine] = useState(false);
  const [editing, setEditing] = useState<ScheduledMessageDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const rows = useScheduledMessages(sel.workspaceId, mine);
  const channels = useChannels(sel.workspaceId);
  const names = useNameMap(sel.workspaceId);
  const memberMap = useMemberMap(sel.workspaceId);
  const list = rows.data ?? [];

  /** How a row names its destination: `# channel`, or the lock for "Just me". */
  const destinationLabel = (channelId: string): string => {
    const c = (channels.data ?? []).find((x) => x.id === channelId);
    if (!c) return 'a conversation';
    if (isSelfDm(c, auth.user.id)) return '🔒 Just me';
    return `# ${c.name ?? ''}`;
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-base">
      <header className="flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-hairline px-[22px] max-md:px-3">
        <MobileMenuButton />
        <div className="min-w-0 flex-1">
          <h2 data-testid="scheduled-header" className="truncate text-[15px] font-bold">
            <span className="text-muted">🕐 </span>Scheduled
          </h2>
          <p className="truncate text-xs text-muted">Messages Flow posts for you, on a schedule</p>
        </div>
        <button
          data-testid="scheduled-new"
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white"
          onClick={() => setCreating(true)}
        >
          + New scheduled message
        </button>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-hairline3 px-[22px] py-2 max-md:px-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
          <input
            data-testid="scheduled-mine-filter"
            type="checkbox"
            checked={mine}
            onChange={(e) => setMine(e.target.checked)}
          />
          Owned by me
        </label>
        <span className="ml-auto text-xs text-faint">{list.length} scheduled</span>
      </div>

      <div className="mc-scroll min-h-0 flex-1 overflow-y-auto p-4 max-md:p-2" data-testid="scheduled-list">
        {list.length === 0 && !rows.isLoading && (
          <div className="py-16 text-center" data-testid="scheduled-empty">
            <p className="text-sm text-faint">
              {mine
                ? 'You haven’t scheduled any messages yet.'
                : 'Nothing is scheduled here yet.'}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-faint">
              Write a message once and Flow posts it as you — a standup prompt every weekday, a digest
              every 12 hours, a reminder to yourself next Tuesday.
            </p>
            <button
              data-testid="scheduled-empty-cta"
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
              onClick={() => setCreating(true)}
            >
              Schedule a message
            </button>
          </div>
        )}

        {list.map((row) => (
          <ScheduledRow
            key={row.id}
            row={row}
            destination={destinationLabel(row.channelId)}
            names={names}
            avatarUrl={memberMap[row.authorUserId]?.avatarUrl ?? null}
            onEdit={() => setEditing(row)}
          />
        ))}

        {list.length > 0 && (
          <p className="mt-4 rounded-lg bg-daypill/50 px-4 py-3 text-xs text-muted">
            🔒 Personal scheduled messages are visible only to you. Ones posting to a channel appear for every
            member of that channel. They run as their owner, with their permissions.
          </p>
        )}
      </div>

      {(creating || editing) && sel.workspaceId && (
        <ScheduleMessageModal
          workspaceId={sel.workspaceId}
          existing={editing ?? undefined}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </section>
  );
}

/**
 * Status pill text/tone. "Running" is the optimistic state while a run-now is in
 * flight — the only moment the client knows something the row doesn't.
 *
 * Failed outranks Paused, because a row the server stopped for itself is a
 * different fact from one you paused on purpose, and it's the one worth
 * surfacing. `lastError` is what tells them apart: the server sets it when it
 * pauses a row, and clears it when a person pauses one.
 */
export function statusOf(row: ScheduledMessageDTO, running: boolean): { label: string; tone: string } {
  if (running) return { label: '● Running', tone: 'bg-accent/10 text-accent-deep' };
  if (row.lastRunStatus === 'failed' && row.lastError) {
    return { label: '✗ Failed', tone: 'bg-red-50 text-red-600' };
  }
  if (!row.enabled) return { label: '⏸ Paused', tone: 'bg-daypill text-muted' };
  if (row.lastRunStatus === 'ok') return { label: '✓ Succeeded', tone: 'bg-green-50 text-green-700' };
  return { label: 'Scheduled', tone: 'bg-daypill text-muted' };
}

function ScheduledRow({
  row,
  destination,
  names,
  avatarUrl,
  onEdit,
}: {
  row: ScheduledMessageDTO;
  destination: string;
  names: Record<string, string>;
  avatarUrl: string | null;
  onEdit: () => void;
}) {
  const sel = useSelection();
  const { remove, setEnabled, runNow } = useScheduledMessageActions();
  const [confirming, setConfirming] = useState(false);
  const running = runNow.isPending && runNow.variables === row.id;
  const status = statusOf(row, running);
  const owner = names[row.authorUserId] ?? 'Someone';
  const preview = plainBody(row.body, names).replace(/\s+/g, ' ').trim();

  return (
    <div
      data-testid={`scheduled-row-${row.id}`}
      data-enabled={row.enabled}
      className={`mb-2 flex items-center gap-3 rounded-xl border border-hairline bg-white px-4 py-3 ${
        row.enabled ? '' : 'opacity-60'
      }`}
    >
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-daypill text-lg">
        🕐
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold" title={preview}>
          {preview || <span className="text-faint italic">(empty message)</span>}
        </p>
        <p className="truncate text-xs text-muted">
          {describeRecurrence(row.recurrence, row.timezone)} · posts to{' '}
          <span className="font-semibold text-accent-soft">{destination}</span>
        </p>
      </div>

      <div className="shrink-0 text-right">
        <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${status.tone}`}>
          {status.label}
        </span>
        <p className="mt-0.5 text-[11px] text-faint">
          {row.lastRunAt ? displayTime(row.lastRunAt) : row.nextRunAt ? `Next ${displayTime(row.nextRunAt)}` : '—'}
          {row.lastMessageId && (
            <>
              {' · '}
              <button
                data-testid={`scheduled-view-output-${row.id}`}
                className="font-semibold text-accent-soft hover:underline"
                onClick={() => sel.jumpToMessage(row.channelId, row.lastMessageId!)}
              >
                view output ↗
              </button>
            </>
          )}
          {row.lastRunStatus === 'failed' && row.lastError && (
            <span title={row.lastError}> · owner notified</span>
          )}
        </p>
      </div>

      <Avatar userId={row.authorUserId} name={owner} avatarUrl={avatarUrl} size={28} radius={8} />

      {/* Actions are the author's and admins' only — everyone else reads the row. */}
      {row.canManage && (
        <div className="flex shrink-0 items-center gap-1" data-testid={`scheduled-actions-${row.id}`}>
          <RowButton
            testid={`scheduled-run-${row.id}`}
            title="Run now"
            disabled={running}
            onClick={() => runNow.mutate(row.id)}
          >
            ▶
          </RowButton>
          <RowButton
            testid={`scheduled-toggle-${row.id}`}
            title={row.enabled ? 'Pause' : 'Resume'}
            onClick={() => setEnabled.mutate({ id: row.id, enabled: !row.enabled })}
          >
            {row.enabled ? '⏸' : '⏵'}
          </RowButton>
          <RowButton testid={`scheduled-edit-${row.id}`} title="Edit" onClick={onEdit}>
            ✏️
          </RowButton>
          <RowButton
            testid={`scheduled-delete-${row.id}`}
            title={confirming ? 'Click again to delete' : 'Delete'}
            onClick={() => (confirming ? remove.mutate(row.id) : setConfirming(true))}
          >
            {confirming ? '✓' : '🗑'}
          </RowButton>
        </div>
      )}
    </div>
  );
}

function RowButton({
  children,
  title,
  testid,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  testid: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="rounded-lg border border-hairline px-2 py-1 text-xs leading-none hover:bg-daypill disabled:opacity-40"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
