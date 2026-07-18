import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { plainBody } from '../lib/format';
import { useLive, useSelection } from '../state';
import { useNameMap, useNotifications } from '../hooks';

export default function NotificationsBell() {
  const live = useLive();
  const sel = useSelection();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const notifications = useNotifications(open);
  const names = useNameMap(sel.workspaceId);

  const markAllRead = async () => {
    const newest = notifications.data?.notifications[0];
    if (!newest) return;
    await api('POST', '/v1/me/notifications/read', { upToId: newest.id });
    live.setNotificationUnread(0);
    await qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const kindLabel = (kind: number, sender: string) =>
    kind === 1 ? `${sender} sent you a direct message`
    : kind === 2 ? `${sender} replied in a thread`
    : kind === 3 ? `${sender} posted`
    : `${sender} mentioned you`;

  return (
    <div className="relative">
      <button
        data-testid="notifications-bell"
        data-unread={live.notificationUnread}
        className="relative rounded px-2 py-1 hover:bg-daypill"
        title="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        🔔
        {live.notificationUnread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {Math.min(live.notificationUnread, 99)}
          </span>
        )}
      </button>
      {open && (
        <div
          data-testid="notifications-panel"
          className="absolute right-0 z-40 mt-1 w-96 rounded-lg border border-hairline bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-hairline3 px-3 py-2">
            <span className="font-semibold">Notifications</span>
            <button
              data-testid="notifications-mark-read"
              className="text-xs text-accent-soft hover:underline"
              onClick={() => void markAllRead()}
            >
              Mark all read
            </button>
          </div>
          <div className="mc-scroll max-h-96 overflow-y-auto">
            {(notifications.data?.notifications ?? []).length === 0 && (
              <p className="py-8 text-center text-sm text-faint">No notifications yet</p>
            )}
            {(notifications.data?.notifications ?? []).map((n) => {
              const sender = names[n.message.userId] ?? 'Someone';
              return (
                <button
                  key={n.id}
                  data-testid={`notification-${n.id}`}
                  data-kind={n.kind}
                  data-read={n.readAt !== null}
                  className="block w-full border-b border-hairline3 px-3 py-2 text-left hover:bg-daypill/50"
                  onClick={async () => {
                    setOpen(false);
                    if (sel.workspaceId !== n.workspaceId) sel.selectWorkspace(n.workspaceId);
                    sel.selectChannel(n.channelId);
                    if (n.message.threadRootId) sel.openThread(n.message.threadRootId);
                    await api('POST', '/v1/me/notifications/read', { upToId: n.id });
                    void qc.invalidateQueries({ queryKey: ['notifications'] });
                  }}
                >
                  <span className={`block text-sm ${n.readAt === null ? 'font-semibold' : ''}`}>
                    {kindLabel(n.kind, sender)}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {plainBody(n.message.body, names)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
