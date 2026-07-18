import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, useLive, useSelection } from '../state';
import { useChannels, useMarkRead, useMemberMap, useMembers, useMessages, useNameMap, flattenMessages } from '../hooks';
import { dmTitle } from './Sidebar';
import { Avatar } from './Avatar';
import MessageList from './MessageList';
import Composer from './Composer';
import NotificationsBell from './NotificationsBell';
import { UserCard } from './modals';

export default function ChannelView({ channelId }: { channelId: string }) {
  const auth = useAuth();
  const sel = useSelection();
  const live = useLive();
  const channels = useChannels(sel.workspaceId);
  const members = useMembers(sel.workspaceId);
  const memberMap = useMemberMap(sel.workspaceId);
  const names = useNameMap(sel.workspaceId);
  const messagesQ = useMessages(channelId);
  const markRead = useMarkRead();
  const lastReadRef = useRef<string | null>(null);
  const [cardUserId, setCardUserId] = useState<string | null>(null);

  const channel = (channels.data ?? []).find((c) => c.id === channelId);
  const messages = useMemo(() => flattenMessages(messagesQ.data?.pages), [messagesQ.data]);

  // mark read whenever the newest visible message changes
  const newestId = messages.length > 0 ? messages[messages.length - 1]!.id : null;
  useEffect(() => {
    if (newestId && newestId !== lastReadRef.current) {
      lastReadRef.current = newestId;
      markRead.mutate({ channelId, lastReadMsgId: newestId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestId, channelId]);

  const isDm = channel && channel.kind !== 'standard';
  // 1:1 DM header click opens the other member's card (ruling 4); self-DM shows your own.
  const dmOtherId =
    channel?.kind === 'dm'
      ? (channel.memberIds ?? []).find((id) => id !== auth.user.id) ?? auth.user.id
      : null;
  const title = channel
    ? channel.kind === 'standard'
      ? channel.name ?? ''
      : dmTitle(channel, names, auth.user.id)
    : '';

  // header avatar stack: channel members for DMs, workspace members otherwise
  const headerIds = (isDm ? channel?.memberIds ?? [] : (members.data ?? []).map((m) => m.userId));
  const shown = headerIds.slice(0, 3);
  const extra = headerIds.length - shown.length;

  const typingNames = Object.entries(live.typing[channelId] ?? {})
    .filter(([uid, ts]) => Date.now() - ts < 5000 && uid !== auth.user.id)
    .map(([uid]) => names[uid] ?? 'Someone');

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-base">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-hairline px-[22px]">
        <div className="min-w-0">
          <h2
            data-testid="channel-header"
            className={`truncate text-[15px] font-bold ${dmOtherId ? 'cursor-pointer hover:underline' : ''}`}
            onClick={dmOtherId ? () => setCardUserId(dmOtherId) : undefined}
          >
            {channel?.kind === 'standard' ? <><span className="text-muted"># </span>{title}</> : title}
          </h2>
          {channel?.topic && <p className="truncate text-xs text-muted">{channel.topic}</p>}
          {channel?.archivedAt && <p className="text-xs text-orange-600">archived</p>}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center">
            {shown.map((id, i) => {
              const m = memberMap[id];
              return (
                <span key={id} className={i > 0 ? '-ml-2.5' : ''}>
                  <Avatar
                    userId={id}
                    name={m?.displayName ?? '?'}
                    avatarUrl={m?.avatarUrl}
                    size={26}
                    radius={13}
                    className="ring-2 ring-base"
                  />
                </span>
              );
            })}
            {extra > 0 && <span className="ml-1.5 text-xs text-muted">+{extra}</span>}
          </div>
          <NotificationsBell />
        </div>
      </header>

      <MessageList
        messages={messages}
        names={names}
        membersById={memberMap}
        hasMore={messagesQ.hasNextPage ?? false}
        onLoadOlder={() => void messagesQ.fetchNextPage()}
        showThreadAffordances
      />

      <div className="h-5 px-[22px] text-xs text-muted" data-testid="typing-indicator-slot">
        {typingNames.length === 1 && <span data-testid="typing-indicator">{typingNames[0]} is typing…</span>}
        {typingNames.length > 1 && <span data-testid="typing-indicator">Several people are typing…</span>}
      </div>

      {channel?.archivedAt ? (
        <p className="px-[22px] pb-[22px] text-sm text-muted">This channel is archived and read-only.</p>
      ) : (
        <Composer channelId={channelId} placeholder={`Message ${channel?.kind === 'standard' ? `#${title}` : title}`} />
      )}

      {cardUserId && <UserCard userId={cardUserId} onClose={() => setCardUserId(null)} />}
    </section>
  );
}
