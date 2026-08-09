import { useEffect, useMemo, useRef, useState } from 'react';
import type { MessageDTO } from '@flow/shared';
import { typingKey, useAuth, useLive, useSelection } from '../state';
import { useArtifacts, useChannelMembers, useChannels, useDisplayNameMap, useMarkRead, useMemberMap, useMessages, useNameMap, usePinnedMessages, useTogglePin, flattenMessages } from '../hooks';
import { dmTitle } from './Sidebar';
import { Avatar } from './Avatar';
import ChannelMembersPopover, { type MemberRow } from './ChannelMembersPopover';
import ChannelOverflowMenu from './ChannelOverflowMenu';
import MessageList, { PinIcon } from './MessageList';
import Composer, { arrowUpEdit } from './Composer';
import { MobileMenuButton } from './MobileMenuButton';
import { ChannelOptionsModal, Modal, UserCard } from './modals';
import { renderBody } from '../lib/format';

export default function ChannelView({ channelId }: { channelId: string }) {
  const auth = useAuth();
  const sel = useSelection();
  const live = useLive();
  const channels = useChannels(sel.workspaceId);
  const memberMap = useMemberMap(sel.workspaceId);
  const names = useNameMap(sel.workspaceId);
  const displayNames = useDisplayNameMap(sel.workspaceId); // agent names carry the 🤖 badge
  const messagesQ = useMessages(channelId);
  const pins = usePinnedMessages(channelId);
  const markRead = useMarkRead();
  const lastReadRef = useRef<string | null>(null);
  const [cardUserId, setCardUserId] = useState<string | null>(null);
  const [editChannel, setEditChannel] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);

  const channel = (channels.data ?? []).find((c) => c.id === channelId);
  // This channel's artifacts, for the "⋯" menu's Artifacts section (#188).
  const artifacts = useArtifacts(sel.workspaceId);
  const channelArtifacts = useMemo(
    () => (artifacts.data ?? []).filter((a) => a.channelId === channelId),
    [artifacts.data, channelId],
  );
  const messages = useMemo(() => flattenMessages(messagesQ.data?.pages), [messagesQ.data]);

  // Mark read whenever the newest visible message changes — but only while
  // the tab is actually visible. The WS keeps filling the cache in a hidden
  // tab, and marking read there silently consumed the very notifications the
  // banner path was raising (the read cursor also clears that channel's
  // notification rows server-side since #63). Coming back catches up.
  const newestId = messages.length > 0 ? messages[messages.length - 1]!.id : null;
  useEffect(() => {
    const sync = () => {
      if (document.hidden) return;
      if (newestId && newestId !== lastReadRef.current) {
        lastReadRef.current = newestId;
        markRead.mutate({ channelId, lastReadMsgId: newestId });
      }
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
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

  // Header avatar stack: this channel's membership for every kind (issue #70 —
  // standard channels used to show the whole workspace roster, which said
  // nothing about who was actually in the channel). The DTO only carries
  // memberIds for DMs, so it's the fallback while the fetch is in flight.
  const chanMembers = useChannelMembers(channelId);
  const headerIds = chanMembers.data ?? channel?.memberIds ?? [];
  const shown = headerIds.slice(0, 3);
  const extra = headerIds.length - shown.length;

  const memberRows: MemberRow[] = headerIds.map((id) => {
    const m = memberMap[id];
    return {
      userId: id,
      displayName: m?.displayName ?? 'Unknown',
      avatarUrl: m?.avatarUrl,
      isAgent: m?.isAgent ?? false,
      statusEmoji: m?.statusEmoji ?? '',
      statusText: m?.statusText ?? '',
      // You're online by definition — this client is the one connected.
      online: id === auth.user.id || !!live.presence[id],
      isSelf: id === auth.user.id,
    };
  });

  // Switching channels shouldn't leave the previous channel's roster hanging open.
  useEffect(() => setMembersOpen(false), [channelId]);

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
          {/* #194: the topic runs through the same inline renderer as a message
              body, so a URL in it is a real link (new tab) instead of grey text. */}
          {channel?.topic && (
            <p data-testid="channel-topic" className="truncate text-xs text-muted">
              {renderBody(channel.topic, names, auth.user.id)}
            </p>
          )}
          {channel?.archivedAt && <p className="text-xs text-orange-600">archived</p>}
        </div>
        <div className="relative flex shrink-0 items-center gap-3">
          {/* member stack — opens the roster; dropped on mobile so the title gets the room */}
          <button
            data-testid="channel-members-trigger"
            data-members-trigger
            title="View members"
            aria-haspopup="dialog"
            aria-expanded={membersOpen}
            className="flex items-center rounded-lg px-1 py-0.5 hover:bg-daypill/60 max-md:hidden"
            onClick={() => setMembersOpen((v) => !v)}
          >
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
            {/* nothing to stack yet (fetch in flight) — keep a clickable target */}
            {shown.length === 0 && <span className="text-sm text-muted">👥</span>}
          </button>
          {/* #188: pins, artifacts and channel options share one "⋯" menu */}
          <button
            type="button"
            data-testid="channel-menu-trigger"
            data-overflow-trigger
            title="Channel menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="rounded-lg px-1.5 py-1 text-[17px] leading-none text-muted hover:bg-daypill/60 hover:text-ink"
            onClick={() => { setMenuOpen((v) => !v); setMembersOpen(false); }}
          >
            ⋯
          </button>
          {membersOpen && (
            <ChannelMembersPopover
              rows={memberRows}
              loading={chanMembers.isLoading}
              onClose={() => setMembersOpen(false)}
              onSelect={(id) => { setMembersOpen(false); setCardUserId(id); }}
            />
          )}
          {menuOpen && (
            <ChannelOverflowMenu
              artifacts={channelArtifacts}
              pinCount={pins.data?.length ?? 0}
              showOptions={channel?.kind === 'standard'}
              onOpenPins={() => setPinsOpen(true)}
              onOpenArtifact={(id) => sel.selectArtifact(id)}
              onOpenOptions={() => setEditChannel(true)}
              onClose={() => setMenuOpen(false)}
            />
          )}
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
          editingMessage={messages.find((m) => m.id === sel.editingMessageId)}
        />
      )}

      {cardUserId && <UserCard userId={cardUserId} onClose={() => setCardUserId(null)} />}
      {editChannel && channel && <ChannelOptionsModal channel={channel} onClose={() => setEditChannel(false)} />}
      {pinsOpen && (
        <PinnedMessagesModal
          messages={pins.data ?? []}
          names={names}
          loading={pins.isLoading}
          onClose={() => setPinsOpen(false)}
        />
      )}
    </section>
  );
}

export function PinnedMessagesModal({
  messages,
  names,
  loading,
  onClose,
}: {
  messages: MessageDTO[];
  names: Record<string, string>;
  loading: boolean;
  onClose: () => void;
}) {
  const sel = useSelection();
  const togglePin = useTogglePin();

  return (
    <Modal onClose={onClose} testid="pinned-messages-modal">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="font-bold">Pinned messages</h3>
        <button className="rounded px-2 text-faint hover:bg-daypill hover:text-ink" onClick={onClose}>×</button>
      </div>
      {loading ? (
        <p className="py-6 text-center text-sm text-muted">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No pinned messages in this channel.</p>
      ) : (
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {messages.map((message) => (
            <div key={message.id} className="flex items-start gap-2 rounded-xl border border-hairline p-2 hover:border-hairline2">
              <button
                type="button"
                className="min-w-0 flex-1 cursor-pointer text-left"
                onClick={() => {
                  sel.jumpToMessage(message.channelId, message.id, message.threadRootId);
                  onClose();
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-xs font-bold">{names[message.userId] ?? 'Unknown'}</span>
                  <span className="shrink-0 text-[11px] text-faint">
                    {message.pinnedAt ? new Date(message.pinnedAt).toLocaleString() : ''}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-3 text-sm text-ink-soft">
                  {message.body.trim() || message.files[0]?.name || 'Message'}
                </p>
                {message.threadRootId && <span className="text-[11px] text-accent-soft">Reply in thread</span>}
              </button>
              <button
                type="button"
                data-testid={`unpin-from-list-${message.id}`}
                title="Unpin message"
                className="shrink-0 rounded-md p-1 text-accent-soft hover:bg-daypill"
                onClick={() => togglePin.mutate(message)}
              >
                <PinIcon filled />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
