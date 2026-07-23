import { useEffect, useMemo, useRef, useState } from 'react';
import { typingKey, useAuth, useLive, useSelection } from '../state';
import { useChannels, useDisplayNameMap, useMarkRead, useMemberMap, useMembers, useMessages, useNameMap, flattenMessages } from '../hooks';
import { dmTitle } from './Sidebar';
import { Avatar } from './Avatar';
import MessageList from './MessageList';
import Composer, { arrowUpEdit } from './Composer';
import { MobileMenuButton } from './MobileMenuButton';
import { EditChannelModal, UserCard } from './modals';

export default function ChannelView({ channelId }: { channelId: string }) {
  const auth = useAuth();
  const sel = useSelection();
  const live = useLive();
  const channels = useChannels(sel.workspaceId);
  const members = useMembers(sel.workspaceId);
  const memberMap = useMemberMap(sel.workspaceId);
  const names = useNameMap(sel.workspaceId);
  const displayNames = useDisplayNameMap(sel.workspaceId); // agent names carry the 🤖 badge
  const messagesQ = useMessages(channelId);
  const markRead = useMarkRead();
  const lastReadRef = useRef<string | null>(null);
  const [cardUserId, setCardUserId] = useState<string | null>(null);
  const [editChannel, setEditChannel] = useState(false);

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

  // Jump-to-message (phase 12): a target from the Activity feed may sit beyond
  // the loaded pages — page older history until it's in the list (MessageList
  // then scrolls to it). Give up (and release the target) once history is
  // exhausted. Thread-reply targets are handled by ThreadPanel, not here.
  const focusId = sel.threadRootId ? null : sel.focusMessageId;
  useEffect(() => {
    if (!focusId) return;
    if (messages.some((m) => m.id === focusId)) return; // loaded — MessageList takes it
    if (messagesQ.hasNextPage && !messagesQ.isFetchingNextPage) {
      void messagesQ.fetchNextPage();
    } else if (!messagesQ.hasNextPage) {
      sel.clearFocusMessage(); // not in this channel's history
    }
  }, [focusId, messages, messagesQ.hasNextPage, messagesQ.isFetchingNextPage, sel]);

  const isDm = channel && channel.kind !== 'standard';
  // 1:1 DM header click opens the other member's card (ruling 4); self-DM shows your own.
  const dmOtherId =
    channel?.kind === 'dm'
      ? (channel.memberIds ?? []).find((id) => id !== auth.user.id) ?? auth.user.id
      : null;
  const title = channel
    ? channel.kind === 'standard'
      ? channel.name ?? ''
      : dmTitle(channel, displayNames, auth.user.id)
    : '';

  // header avatar stack: channel members for DMs, workspace members otherwise
  const headerIds = (isDm ? channel?.memberIds ?? [] : (members.data ?? []).map((m) => m.userId));
  const shown = headerIds.slice(0, 3);
  const extra = headerIds.length - shown.length;

  // Main-composer typing only — thread typing shows in its own panel. An agent
  // at work "thinks" rather than "types" (ui_nits), so carry the isAgent flag.
  const typers = Object.entries(live.typing[typingKey(channelId)] ?? {})
    .filter(([uid, ts]) => Date.now() - ts < 5000 && uid !== auth.user.id)
    .map(([uid]) => ({ name: names[uid] ?? 'Someone', isAgent: memberMap[uid]?.isAgent ?? false }));

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-base">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-hairline px-[22px] max-md:px-3">
        <MobileMenuButton />
        <div className="min-w-0 flex-1">
          <h2
            data-testid="channel-header"
            className={`truncate text-[15px] font-bold ${dmOtherId || channel?.kind === 'standard' ? 'cursor-pointer hover:underline' : ''}`}
            title={channel?.kind === 'standard' ? 'Edit name & topic' : undefined}
            onClick={
              dmOtherId
                ? () => setCardUserId(dmOtherId)
                // Clicking a standard channel's name opens the name/topic editor (ui_nits item 5).
                : channel?.kind === 'standard'
                  ? () => setEditChannel(true)
                  : undefined
            }
          >
            {channel?.kind === 'standard' ? <><span className="text-muted"># </span>{title}</> : title}
          </h2>
          {channel?.topic && <p className="truncate text-xs text-muted">{channel.topic}</p>}
          {channel?.archivedAt && <p className="text-xs text-orange-600">archived</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* decorative member stack — dropped on mobile so the title gets the room */}
          <div className="flex items-center max-md:hidden">
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
        </div>
      </header>

      {/* key: fresh list per channel so the mount effect re-runs — it restores
          this channel's remembered scroll position (or lands at the bottom when
          there's none / it's stale), keyed by channelId in scrollMemory. */}
      <MessageList
        key={channelId}
        scrollKey={channelId}
        messages={messages}
        names={names}
        membersById={memberMap}
        hasMore={messagesQ.hasNextPage ?? false}
        onLoadOlder={() => void messagesQ.fetchNextPage()}
        showThreadAffordances
        focusMessageId={focusId}
        onFocused={() => sel.clearFocusMessage()}
      />

      <div className="h-5 px-[22px] text-xs text-muted" data-testid="typing-indicator-slot">
        {typers.length === 1 && (
          <span data-testid="typing-indicator">
            {typers[0]!.name} is {typers[0]!.isAgent ? 'thinking' : 'typing'}…
          </span>
        )}
        {typers.length > 1 && <span data-testid="typing-indicator">Several people are typing…</span>}
      </div>

      {channel?.archivedAt ? (
        <p className="px-[22px] pb-[22px] text-sm text-muted">This channel is archived and read-only.</p>
      ) : (
        <Composer
          channelId={channelId}
          placeholder={`Message ${channel?.kind === 'standard' ? `#${title}` : title}`}
          onArrowUpEdit={arrowUpEdit(messages, auth.user.id, sel.setEditingMessage)}
        />
      )}

      {cardUserId && <UserCard userId={cardUserId} onClose={() => setCardUserId(null)} />}
      {editChannel && channel && <EditChannelModal channel={channel} onClose={() => setEditChannel(false)} />}
    </section>
  );
}
