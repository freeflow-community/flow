// Activity feed (phase 12) — a virtual, always-present per-user "channel" that
// replaces the old notifications bell. It surfaces this user's notification
// rows (mentions, DMs, thread replies, notify-all activity) as a message-like
// stream. Not a real channel: no server row, no membership — the data is the
// same /v1/me/notifications feed the bell used, rendered full-pane.
//
// Opening it behaves like opening a channel: everything up to the newest row is
// marked read and the sidebar's unread badge clears. Clicking a row jumps to
// the originating message (switching workspace/opening the thread as needed).
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { displayTime, plainBody } from '../lib/format';
import { useLive, useSelection } from '../state';
import { useMemberMap, useNameMap, useNotifications } from '../hooks';
import { Avatar } from './Avatar';
import { MobileMenuButton } from './MobileMenuButton';

const kindLabel = (kind: number, sender: string, emoji: string | null) =>
  kind === 1 ? `${sender} sent you a direct message`
  : kind === 2 ? `${sender} replied in a thread`
  : kind === 3 ? `${sender} posted`
  : kind === 4 ? `${sender} reacted ${emoji ?? ''} to your message`.replace('  ', ' ')
  : `${sender} mentioned you`;

export default function ActivityView() {
  const sel = useSelection();
  const live = useLive();
  const qc = useQueryClient();
  const notifications = useNotifications(true, sel.workspaceId);
  const names = useNameMap(sel.workspaceId);
  const memberMap = useMemberMap(sel.workspaceId);
  const rows = notifications.data?.notifications ?? [];

  // Opening the feed marks everything up to the newest row read (channel
  // semantics), clearing the sidebar badge. Guarded by a ref so a re-render
  // doesn't re-POST; re-runs only when a newer row arrives while we're open.
  // workspaceId keeps the sweep inside this workspace — the cursor is a plain
  // id comparison server-side, so without it older rows in other workspaces
  // (which this feed never showed) would go read too.
  // The guard key carries the workspace too: a switch re-marks the new feed
  // (a different workspace is a different feed) without re-POSTing this one.
  const markedRef = useRef<string | null>(null);
  const newestId = rows[0]?.id ?? null;
  const workspaceId = sel.workspaceId;
  useEffect(() => {
    const markKey = workspaceId && newestId ? `${workspaceId}:${newestId}` : null;
    if (!markKey || markedRef.current === markKey) return;
    markedRef.current = markKey;
    live.setNotificationUnread(0);
    void api('POST', '/v1/me/notifications/read', { upToId: newestId, workspaceId })
      .then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
  }, [newestId, workspaceId, live, qc]);

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-base">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-hairline px-[22px] max-md:px-3">
        <MobileMenuButton />
        <div className="min-w-0 flex-1">
          <h2 data-testid="activity-header" className="truncate text-[15px] font-bold">
            <span className="text-muted"># </span>Activity
          </h2>
          <p className="truncate text-xs text-muted">Mentions, direct messages &amp; replies</p>
        </div>
      </header>

      <div className="mc-scroll min-h-0 flex-1 overflow-y-auto" data-testid="activity-list">
        {rows.length === 0 && (
          <p className="py-16 text-center text-sm text-faint">No activity yet</p>
        )}
        {rows.map((n) => {
          // Who to show: the reactor on a reaction row, the author otherwise.
          const actorId = n.actorId ?? n.message.userId;
          const sender = names[actorId] ?? 'Someone';
          const m = memberMap[actorId];
          return (
            <button
              key={n.id}
              data-testid={`activity-${n.id}`}
              data-kind={n.kind}
              data-read={n.readAt !== null}
              className="flex w-full items-start gap-3 border-b border-hairline3 px-[22px] py-3 text-left hover:bg-daypill/50 max-md:px-3"
              onClick={async () => {
                if (sel.workspaceId !== n.workspaceId) sel.selectWorkspace(n.workspaceId);
                // Jump straight to the triggering message (scroll + flash),
                // opening its thread first when it's a thread reply.
                sel.jumpToMessage(n.channelId, n.messageId, n.message.threadRootId);
                await api('POST', '/v1/me/notifications/read', { id: n.id });
                void qc.invalidateQueries({ queryKey: ['notifications'] });
              }}
            >
              <Avatar userId={actorId} name={m?.displayName ?? sender} avatarUrl={m?.avatarUrl} size={34} radius={9} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={`truncate text-sm ${n.readAt === null ? 'font-semibold' : ''}`}>
                    {kindLabel(n.kind, sender, n.reactionEmoji)}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-faint">{displayTime(n.createdAt)}</span>
                </span>
                <span className="mt-0.5 block truncate text-sm text-muted">
                  {plainBody(n.message.body, names)}
                </span>
              </span>
              {n.readAt === null && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-unread" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
