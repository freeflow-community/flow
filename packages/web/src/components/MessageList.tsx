import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ArtifactDTO, FileDTO, MessageDTO, WorkspaceMemberDTO } from '@flow/shared';
import { api, blobUrl, fileStreamUrl, fileText } from '../lib/api';
import { bytesLabel, displayTime, InlineLinkContext, renderBlocks } from '../lib/format';
import { isTextFile, isVideoFile } from '../lib/fileKind';
import { INTERRUPT_EMOJI, isThinkingStatus, THINKING_PREFIX } from '../lib/agentStatus';
import { useAuth, useSelection } from '../state';
import { useSendMessage, useTogglePin, useToggleReaction } from '../hooks';
import type { LocalMessage } from '../lib/messageCache';
import { Avatar, AuthImg } from './Avatar';
import EmojiPicker from './EmojiPicker';
import { Modal, UserCard } from './modals';
import { UnfurlCard } from './UnfurlCard';
import {
  AddReactionIcon,
  AgentMarkIcon,
  ArrowDownIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  CopyIcon,
  DocIcon,
  DownloadIcon,
  EditIcon,
  ExternalIcon,
  PinIcon,
  StopIcon,
  ThreadIcon,
  TrashIcon,
} from './icons';

export { PinIcon } from './icons';

/** Remembered scroll position per channel, so switching away and back lands
 * where you left off (ui_nits). Kept module-level (survives the per-channel
 * remount forced by `key={channelId}`) and short-lived: after TTL the entry is
 * ignored and you snap back to the bottom, the freshest place to be. */
const SCROLL_MEMORY_TTL = 5 * 60_000;
const scrollMemory = new Map<string, { top: number; ts: number; pinned: boolean }>();

export default function MessageList({
  messages,
  names,
  membersById = {},
  hasMore,
  onLoadOlder,
  showThreadAffordances,
  emptyState,
  scrollKey,
  focusMessageId = null,
  onFocused,
}: {
  messages: MessageDTO[];
  names: Record<string, string>;
  membersById?: Record<string, WorkspaceMemberDTO>;
  hasMore: boolean;
  onLoadOlder: () => void;
  showThreadAffordances: boolean;
  /** Rendered when the list is empty with no older pages — channels pass a
   * designed welcome; threads omit it (the root message is context enough). */
  emptyState?: React.ReactNode;
  /** Enables per-view scroll-position memory (channels pass their id; threads omit it). */
  scrollKey?: string;
  /** Jump-to-message target (phase 12): scroll it into view + flash it once
   * it's rendered, then call onFocused. */
  focusMessageId?: string | null;
  onFocused?: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true); // at (or near) the bottom, so growth should keep us there
  const lastTopRef = useRef(0);
  // A pending jump suppresses the bottom-pin so it doesn't yank us off the
  // target message we're scrolling to.
  const focusRef = useRef<string | null>(focusMessageId);
  focusRef.current = focusMessageId;
  const lastId = messages.length > 0 ? messages[messages.length - 1]!.id : null;
  // Reading back-scroll → offer a way back to the newest message (#111).
  // `pinnedRef` is a ref (it's read from scroll/resize handlers), so mirror it
  // into state for rendering.
  const [showJump, setShowJump] = useState(false);

  // Raise the jump button once we're both unpinned and visibly short of the
  // end (the slack keeps a part-scrolled last message from raising it).
  const syncJump = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    setShowJump(!pinnedRef.current && gap > 120);
  };

  const jumpToLatest = () => {
    pinnedRef.current = true;
    setShowJump(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };

  // On mount, restore a recent remembered position; otherwise land at the
  // bottom. Runs before paint so the viewport never flashes the bottom first.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // A pending jump-to-message owns the scroll — let its effect place us,
    // instead of flashing the remembered/bottom position first.
    if (focusRef.current) {
      pinnedRef.current = false;
      return;
    }
    const mem = scrollKey ? scrollMemory.get(scrollKey) : undefined;
    if (mem && Date.now() - mem.ts < SCROLL_MEMORY_TTL && !mem.pinned) {
      scroller.scrollTop = mem.top;
      pinnedRef.current = false;
      lastTopRef.current = mem.top;
      syncJump(); // opened mid-history — offer the way back down right away
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      pinnedRef.current = true;
      if (scrollKey) scrollMemory.delete(scrollKey); // expired → forget it
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new message keeps us at the bottom only while we're pinned there — if the
  // user has scrolled up (to read, or restored from memory), don't yank them.
  useEffect(() => {
    if (focusRef.current) return; // a jump owns the scroll position
    if (pinnedRef.current) bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [lastId]);

  // Jump-to-message: once the target row is in the DOM (it may take a few
  // older-history pages to arrive), center it and flash it, then release.
  useEffect(() => {
    if (!focusMessageId) return;
    const el = scrollerRef.current?.querySelector(
      `[data-testid="message-${CSS.escape(focusMessageId)}"]`,
    );
    if (!el) return; // not loaded yet — re-runs when `messages` grows
    pinnedRef.current = false; // stop the bottom-pin from fighting the scroll
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('mc-flash');
    const t = window.setTimeout(() => {
      el.classList.remove('mc-flash');
      onFocused?.();
    }, 2000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessageId, messages]);

  // Attachments (images, text previews) finish loading after the initial
  // scroll and grow the content, leaving a freshly opened channel short of
  // the bottom. Stay pinned to the bottom as content grows until the user
  // scrolls away (macOS gets this from defaultScrollAnchor(.bottom)).
  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    // A scroll event lands a frame after the scroll that caused it, so by the
    // time it runs the content may already have grown again (a late unfurl
    // card, an image finishing). Distance-from-bottom alone therefore can't
    // tell "the user scrolled away" from "the page grew under us" — reading it
    // that way let our own pinning scroll come back as a 286px gap and latch
    // pinned=false, stranding the viewport above the newest card. Growth never
    // moves scrollTop up, so that (not the distance) is the leaving-the-bottom
    // signal; the distance only ever pins us back on.
    const remember = () => {
      if (scrollKey) scrollMemory.set(scrollKey, { top: scroller.scrollTop, ts: Date.now(), pinned: pinnedRef.current });
    };
    const onScroll = () => {
      const top = scroller.scrollTop;
      if (scroller.scrollHeight - top - scroller.clientHeight < 40) pinnedRef.current = true;
      else if (top < lastTopRef.current - 1) pinnedRef.current = false;
      lastTopRef.current = top;
      syncJump();
      remember();
    };
    scroller.addEventListener('scroll', onScroll);
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) scroller.scrollTop = scroller.scrollHeight;
      // A message arriving while we're scrolled up grows the content without a
      // scroll event — that's when the jump button has to appear (#111).
      syncJump();
    });
    observer.observe(content);
    return () => {
      remember(); // capture the final position for the return visit
      scroller.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollerRef} className="mc-scroll min-h-0 flex-1 overflow-y-auto py-2" data-testid="message-list">
        <div ref={contentRef}>
          {hasMore && (
            <div className="py-1 text-center">
              <button className="text-sm font-semibold text-accent-soft hover:underline" onClick={onLoadOlder}>
                Load earlier messages
              </button>
            </div>
          )}
          {messages.length === 0 && !hasMore && emptyState}
          {messages.map((m, i) => (
            <div key={m.id}>
              {startsNewDay(messages, i) && <DayDivider iso={m.createdAt} />}
              {m.systemKind ? (
                <SystemLine message={m} />
              ) : (
                <MessageRow
                  message={m}
                  names={names}
                  membersById={membersById}
                  showHeader={showsHeader(messages, i)}
                  showThreadAffordances={showThreadAffordances}
                />
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {showJump && (
        <button
          type="button"
          data-testid="jump-to-latest"
          className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 cursor-pointer rounded-full border border-hairline bg-white px-3 py-1.5 text-xs font-semibold text-accent-soft shadow-md hover:border-hairline2"
          onClick={jumpToLatest}
        >
          <span className="flex items-center gap-1.5">
            Jump to latest
            <ArrowDownIcon size={12} />
          </span>
        </button>
      )}
    </div>
  );
}

function showsHeader(messages: MessageDTO[], index: number): boolean {
  if (index === 0) return true;
  if (startsNewDay(messages, index)) return true;
  const prev = messages[index - 1]!;
  const cur = messages[index]!;
  // A system line (join/leave) breaks a run — the next real message always
  // re-shows its author header rather than merging into the pre-notice group.
  if (prev.systemKind) return true;
  if (prev.userId !== cur.userId) return true;
  return new Date(cur.createdAt).getTime() - new Date(prev.createdAt).getTime() > 300_000;
}

function startsNewDay(messages: MessageDTO[], index: number): boolean {
  if (index === 0) return true;
  return (
    new Date(messages[index - 1]!.createdAt).toDateString() !==
    new Date(messages[index]!.createdAt).toDateString()
  );
}

function DayDivider({ iso }: { iso: string }) {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  const label =
    d.toDateString() === now.toDateString()
      ? 'Today'
      : d.toDateString() === yesterday.toDateString()
        ? 'Yesterday'
        : d.toLocaleDateString([], { month: 'long', day: 'numeric' });
  return (
    <div className="my-2 text-center">
      <span className="rounded-[20px] bg-daypill px-3 py-[3px] text-[11px] text-faint">{label}</span>
    </div>
  );
}

/** A channel event line (join/leave) — centered, muted, no avatar/header.
 * The body is the pre-rendered sentence ("Alice joined the channel"). */
function SystemLine({ message }: { message: MessageDTO }) {
  return (
    <div data-testid={`system-message-${message.id}`} className="py-1 text-center">
      <span className="text-[11px] text-faint">{message.body}</span>
    </div>
  );
}

/** Quick one-tap reactions shown first in the message hover menu (operator
 * pick). The add-reaction button beside them still opens the full picker. */
const QUICK_REACTIONS = ['👍', '👀', '🙌'];

/** A reaction pill. Pops (mc-reaction-pop) only when it arrives on an
 * already-visible row — history renders still, live reactions feel alive. */
function ReactionChip({
  emoji,
  count,
  mine,
  title,
  rowMountedAt,
  onClick,
}: {
  emoji: string;
  count: number;
  mine: boolean;
  title: string;
  rowMountedAt: number;
  onClick: () => void;
}) {
  const [pop] = useState(() => Date.now() - rowMountedAt > 400);
  return (
    <button
      data-testid={`reaction-${emoji}`}
      data-count={count}
      data-mine={mine}
      title={title}
      className={`rounded-[20px] border bg-white px-[9px] py-[2px] text-xs transition-[border-color,transform] duration-100 ease-out-quart active:scale-90 ${
        mine ? 'border-accent-soft/40' : 'border-hairline hover:border-hairline2'
      } ${pop ? 'mc-reaction-pop' : ''}`}
      onClick={onClick}
    >
      {emoji} <span className={`font-bold ${mine ? 'text-accent-soft' : 'text-ink-soft'}`}>{count}</span>
    </button>
  );
}

/** Human-readable text for an agent's status row: the bridge writes
 * `🤖 *thinking…*` plus an optional per-tool suffix; strip the protocol
 * prefix and markdown emphasis so the designed row reads cleanly. */
function thinkingLabel(body: string): string {
  const rest = body.slice(THINKING_PREFIX.length).replace(/^\s*[—–-]\s*/, '').replaceAll('*', '').trim();
  return rest || 'Thinking…';
}

/** "12m ago" style label for thread indicators. */
function relTime(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function MessageRow({
  message,
  names,
  membersById,
  showHeader,
  showThreadAffordances,
}: {
  message: MessageDTO;
  names: Record<string, string>;
  membersById: Record<string, WorkspaceMemberDTO>;
  showHeader: boolean;
  showThreadAffordances: boolean;
}) {
  const auth = useAuth();
  const sel = useSelection();
  const qc = useQueryClient();
  const toggle = useToggleReaction();
  const togglePin = useTogglePin();
  const [showPicker, setShowPicker] = useState(false);
  // Clicking the sender's avatar opens their profile card (ui_nits).
  const [showCard, setShowCard] = useState(false);
  // Editing state lives in the selection context; the edit itself happens in the
  // prompt editor (ui_nits), so here we only highlight the row and hide its hover
  // menu while it's the one loaded in the composer.
  const editing = sel.editingMessageId === message.id;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mine = message.userId === auth.user.id;
  const sender = names[message.userId] ?? 'Unknown';
  const member = membersById[message.userId];
  // Optimistic row awaiting the server echo: dimmed, actions suppressed.
  const pending = (message as LocalMessage).pending === true;
  // Optimistic row whose POST errored out: kept in place with Retry/discard.
  const failed = (message as LocalMessage).failed === true;
  const send = useSendMessage(message.channelId);
  // The agent's live "thinking…" row carries its own stop control (issue #67):
  // reacting 🛑 is what tells the bridge to end that turn.
  const thinking = !message.deletedAt && member?.isAgent === true && isThinkingStatus(message.body);
  const stopping = message.reactions.some(
    (r) => r.emoji === INTERRUPT_EMOJI && r.userIds.includes(auth.user.id),
  );
  // Send-settle / arrival: rows born in the last moments rise into place —
  // your optimistic send and live incoming messages, never scrollback. Own
  // confirmed rows skip it (the ack remount would double-animate the settle).
  const [riseIn] = useState(
    () => (pending || !mine) && Date.now() - new Date(message.createdAt).getTime() < 3000,
  );
  // Reaction chips added while the row is on screen pop; chips that arrive
  // with the row (initial channel render) don't.
  const rowMountedAt = useRef(Date.now());

  // Pin the message's file(s) as shared artifacts in this channel (phase 13);
  // the new artifact opens in the side panel automatically.
  const pinFiles = async () => {
    let last: ArtifactDTO | null = null;
    for (const f of message.files) {
      last = await api<ArtifactDTO>('POST', '/v1/artifacts', { channelId: message.channelId, fileId: f.id });
    }
    await qc.invalidateQueries({ queryKey: ['artifacts', sel.workspaceId] });
    if (last) sel.selectArtifact(last.id);
  };

  // Pin a bare link from the message body as a co-browsing artifact and open it.
  const pinUrl = async (url: string) => {
    const a = await api<ArtifactDTO>('POST', '/v1/artifacts', { channelId: message.channelId, url });
    await qc.invalidateQueries({ queryKey: ['artifacts', sel.workspaceId] });
    sel.selectArtifact(a.id);
  };

  return (
    <div
      data-testid={`message-${message.id}`}
      data-pending={pending || undefined}
      className={`group relative flex gap-2.5 px-[22px] ${editing ? 'bg-accent/5' : 'hover:bg-daypill/40'} ${showHeader ? 'mt-3' : 'py-px'} ${pending ? 'opacity-55' : ''} ${riseIn ? 'mc-rise-in' : ''} transition-opacity duration-300`}
    >
      <div className="w-[38px] shrink-0">
        {showHeader && (
          <button
            type="button"
            data-testid={`avatar-${message.userId}`}
            title={`View ${sender}'s profile`}
            className="block cursor-pointer leading-none"
            onClick={() => setShowCard(true)}
          >
            <Avatar userId={message.userId} name={sender} avatarUrl={member?.avatarUrl} size={38} radius={11} agent={member?.isAgent} />
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-[-0.006em] text-ink">
              {sender}
              {member?.isAgent && (
                <span
                  className="ml-1 inline-flex align-baseline text-accent-soft"
                  title="AI agent"
                  data-testid={`agent-badge-${sender}`}
                >
                  <AgentMarkIcon size={11} />
                </span>
              )}
              {member?.statusEmoji && (
                <span className="ml-1 text-sm font-normal" title={member.statusText} data-testid={`status-of-${sender}`}>
                  {member.statusEmoji}
                </span>
              )}
            </span>
            <span className="text-[11px] text-faint tabular-nums">{displayTime(message.createdAt)}</span>
          </div>
        )}

        {message.deletedAt ? (
          <p className="text-sm text-faint italic">This message was deleted</p>
        ) : (
          <>
            {message.pinnedAt && (
              <div
                data-testid={`pinned-marker-${message.id}`}
                className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-accent-soft"
                title={`Pinned${message.pinnedBy ? ` by ${names[message.pinnedBy] ?? 'a channel member'}` : ''}`}
              >
                <PinIcon filled />
                <span>Pinned</span>
              </div>
            )}
            {thinking ? (
              /* The agent's live status row — the signature surface. A breathing
                 spark, the current status, and the stop control, in place of the
                 raw `🤖 *thinking…*` protocol text the bridge writes. */
              <div className="flex flex-wrap items-center gap-2.5 py-0.5">
                <span className="mc-think flex text-accent" aria-hidden>
                  <AgentMarkIcon size={13} />
                </span>
                <span className="text-sm text-ink-soft italic">{thinkingLabel(message.body)}</span>
                <button
                  type="button"
                  data-testid={`interrupt-${message.id}`}
                  disabled={stopping || pending}
                  title={stopping ? 'Stopping…' : 'Stop this agent turn'}
                  className={`rounded-[20px] border px-[9px] py-[2px] text-xs font-semibold transition-colors duration-100 ${
                    stopping
                      ? 'border-hairline text-faint'
                      : 'border-hairline bg-white text-ink-soft hover:border-hairline2 hover:text-ink'
                  }`}
                  onClick={() => toggle.mutate({ message, emoji: INTERRUPT_EMOJI, mine: false })}
                >
                  <span className="flex items-center gap-1">
                    <StopIcon size={11} />
                    {stopping ? 'Stopping…' : 'Interrupt'}
                  </span>
                </button>
              </div>
            ) : (
              message.body.trim() && (
                <div className="text-sm leading-[1.45] break-words whitespace-pre-wrap text-ink">
                  <InlineLinkContext.Provider value={{ onPinLink: (url) => void pinUrl(url) }}>
                    {renderBlocks(message.body, names, auth.user.id)}
                  </InlineLinkContext.Provider>
                  {message.editedAt && <span className="ml-1 text-xs text-faint">(edited)</span>}
                </div>
              )
            )}
            {message.files.map((f) => (
              <Attachment key={f.id} file={f} />
            ))}
            {failed && (
              <div
                data-testid={`send-failed-${(message as LocalMessage).clientMsgId}`}
                className="mt-0.5 flex items-center gap-2 text-xs text-red-600"
              >
                <span>Failed to send.</span>
                <button
                  type="button"
                  className="font-semibold underline hover:no-underline"
                  onClick={() => send.retry((message as LocalMessage).clientMsgId)}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="flex items-center text-muted hover:text-ink"
                  title="Discard"
                  onClick={() =>
                    send.discard((message as LocalMessage).clientMsgId, message.threadRootId ?? undefined)
                  }
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            )}
            {/* Phase 11: link previews sit below the body/attachments and above
                reactions. Only the author gets the remove affordance (§10). */}
            {message.unfurls.map((u) => (
              <UnfurlCard
                key={u.urlHash}
                unfurl={u}
                messageId={message.id}
                channelId={message.channelId}
                workspaceId={sel.workspaceId}
                canRemove={message.userId === auth.user.id}
              />
            ))}
            {message.reactions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {message.reactions.map((r) => {
                  const mineR = r.userIds.includes(auth.user.id);
                  return (
                    <ReactionChip
                      key={r.emoji}
                      emoji={r.emoji}
                      count={r.count}
                      mine={mineR}
                      title={r.userIds.map((id) => names[id] ?? '?').join(', ')}
                      rowMountedAt={rowMountedAt.current}
                      onClick={() => toggle.mutate({ message, emoji: r.emoji, mine: mineR })}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}

        {showThreadAffordances && message.replyCount > 0 && (
          <button
            data-testid={`thread-open-${message.id}`}
            className="mt-1 flex cursor-pointer items-center gap-2 rounded-[10px] border border-hairline bg-white py-[5px] pr-2.5 pl-1.5 text-xs hover:border-hairline2"
            onClick={() => sel.openThread(message.id)}
          >
            {(message.replyParticipantUserIds ?? []).length > 0 && (
              <span className="flex -space-x-1.5" data-testid={`thread-participants-${message.id}`}>
                {message.replyParticipantUserIds.map((id) => (
                  <Avatar
                    key={id}
                    userId={id}
                    name={names[id] ?? 'Unknown'}
                    avatarUrl={membersById[id]?.avatarUrl}
                    size={20}
                    radius={6}
                    className="ring-2 ring-white"
                  />
                ))}
              </span>
            )}
            <span className="font-[650] text-accent-soft">
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            </span>
            {message.lastReplyAt && <span className="text-[11px] text-faint">Last reply {relTime(message.lastReplyAt)}</span>}
          </button>
        )}
      </div>

      {!message.deletedAt && !editing && !pending && !failed && (
        <div className="pointer-events-none absolute top-0 right-[22px] flex translate-y-0.5 items-center gap-0.5 rounded-xl border border-hairline bg-white px-1.5 py-1 opacity-0 shadow-pop transition-[opacity,transform] duration-100 ease-out-quart group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100">
          {QUICK_REACTIONS.map((emoji) => {
            const mineR = message.reactions.find((r) => r.emoji === emoji)?.userIds.includes(auth.user.id) ?? false;
            return (
              <button
                key={emoji}
                data-testid={`quick-react-${emoji}-${message.id}`}
                className="rounded-md px-1.5 py-1 text-lg leading-none hover:bg-daypill"
                title={`React ${emoji}`}
                onClick={() => toggle.mutate({ message, emoji, mine: mineR })}
              >
                {emoji}
              </button>
            );
          })}
          <div className="mx-0.5 h-6 w-px self-center bg-hairline" />
          <button
            data-testid={`add-reaction-${message.id}`}
            className="flex items-center rounded-md px-1.5 py-1.5 text-ink-soft hover:bg-daypill hover:text-ink"
            title="Add reaction"
            onClick={() => setShowPicker(true)}
          >
            <AddReactionIcon />
          </button>
          {showThreadAffordances && (
            <button
              className="flex items-center rounded-md px-1.5 py-1.5 text-ink-soft hover:bg-daypill hover:text-ink"
              title="Reply in thread"
              onClick={() => sel.openThread(message.threadRootId ?? message.id)}
            >
              <ThreadIcon />
            </button>
          )}
          {message.body && (
            <button
              data-testid={`copy-message-${message.id}`}
              className="flex items-center rounded-md px-1.5 py-1.5 text-ink-soft hover:bg-daypill hover:text-ink"
              title="Copy text"
              onClick={() => void navigator.clipboard?.writeText(message.body)}
            >
              <CopyIcon />
            </button>
          )}
          <button
            data-testid={`toggle-pin-${message.id}`}
            className={`flex items-center rounded-md px-1.5 py-1.5 hover:bg-daypill ${
              message.pinnedAt ? 'text-accent-soft' : 'text-ink-soft hover:text-ink'
            }`}
            title={message.pinnedAt ? 'Unpin message' : 'Pin message'}
            onClick={() => togglePin.mutate(message)}
          >
            <PinIcon filled={!!message.pinnedAt} />
          </button>
          {message.files.length > 0 && (
            <button
              data-testid={`pin-artifact-${message.id}`}
              className="flex items-center rounded-md px-1.5 py-1.5 text-ink-soft hover:bg-daypill hover:text-ink"
              title="Pin as artifact"
              onClick={() => void pinFiles()}
            >
              <ExternalIcon />
            </button>
          )}
          {mine && (
            <>
              <button
                data-testid={`edit-message-${message.id}`}
                className="flex items-center rounded-md px-1.5 py-1.5 text-ink-soft hover:bg-daypill hover:text-ink"
                title="Edit"
                onClick={() => sel.setEditingMessage(message.id)}
              >
                <EditIcon />
              </button>
              <button
                data-testid={`delete-message-${message.id}`}
                className="flex items-center rounded-md px-1.5 py-1.5 text-ink-soft hover:bg-daypill hover:text-red-600"
                title="Delete"
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon />
              </button>
            </>
          )}
        </div>
      )}

      {showCard && <UserCard userId={message.userId} onClose={() => setShowCard(false)} />}

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)} testid="delete-confirm-modal">
          <h3 className="mb-2 font-bold">Delete message?</h3>
          <p className="mb-3 text-sm text-muted">This can't be undone.</p>
          <div className="flex justify-end gap-2">
            <button className="px-3 py-1.5 text-sm text-ink-soft" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button
              data-testid="delete-confirm"
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white"
              onClick={() => {
                setConfirmDelete(false);
                void api('DELETE', `/v1/messages/${message.id}`);
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}

      {showPicker && (
        <div className="absolute top-6 right-[22px] z-30">
          <EmojiPicker
            onPick={(emoji) => {
              setShowPicker(false);
              const mineR = message.reactions.find((r) => r.emoji === emoji)?.userIds.includes(auth.user.id) ?? false;
              toggle.mutate({ message, emoji, mine: mineR });
            }}
            onClose={() => setShowPicker(false)}
          />
        </div>
      )}
    </div>
  );
}

// Collapsed-image state (phase 5 ruling): persisted per device, capped list.
const COLLAPSE_KEY = 'flow.collapsedImages';
const COLLAPSE_CAP = 500;
function collapsedIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function persistCollapsed(fileId: string, collapsed: boolean): void {
  const ids = collapsedIds().filter((id) => id !== fileId);
  if (collapsed) ids.push(fileId);
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(ids.slice(-COLLAPSE_CAP)));
}

const TEXT_PREVIEW_LINES = 10;
const TEXT_EXPAND_MAX = 100_000; // chars shown when expanded (phase 6 ruling)

function useCollapsed(fileId: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => collapsedIds().includes(fileId));
  const toggle = () =>
    setCollapsed((c) => {
      persistCollapsed(fileId, !c);
      return !c;
    });
  return [collapsed, toggle];
}

function useDownload(file: FileDTO): () => Promise<void> {
  return async () => {
    const url = await blobUrl(`/v1/files/${file.id}`);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  };
}

function CardHeader({
  file,
  collapsed,
  onToggle,
}: {
  file: FileDTO;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-1 text-[11px] text-faint">
      <button
        data-testid={`file-collapse-${file.name}`}
        className="flex w-4 items-center hover:text-ink"
        title={collapsed ? 'Show preview' : 'Hide preview'}
        onClick={onToggle}
      >
        {collapsed ? <ChevronRightIcon size={11} /> : <ChevronDownIcon size={11} />}
      </button>
      <span className="truncate">{file.name}</span>
    </div>
  );
}

function DownloadHoverButton({ file, onDownload }: { file: FileDTO; onDownload: () => Promise<void> }) {
  return (
    <button
      data-testid={`file-download-${file.name}`}
      className="absolute top-1.5 right-1.5 z-10 hidden h-7 w-7 items-center justify-center rounded-lg border border-hairline bg-white/90 text-ink-soft shadow-sm hover:bg-white hover:text-ink group-hover/att:flex"
      title="Download"
      onClick={() => void onDownload()}
    >
      <DownloadIcon size={14} />
    </button>
  );
}

function Attachment({ file }: { file: FileDTO }) {
  if (file.hasThumb) return <ImageAttachment file={file} />;
  if (isVideoFile(file)) return <VideoAttachment file={file} />;
  if (file.mimeType === 'application/pdf') return <PdfAttachment file={file} />;
  if (isTextFile(file)) return <TextAttachment file={file} />;
  return <FileChip file={file} />;
}

function ImageAttachment({ file }: { file: FileDTO }) {
  const [collapsed, toggleCollapsed] = useCollapsed(file.id);
  const [lightbox, setLightbox] = useState(false);
  const download = useDownload(file);

  // GIFs skip the static webp thumb and render the original so they animate.
  const imgPath = file.mimeType === 'image/gif' ? `/v1/files/${file.id}` : `/v1/files/${file.id}/thumb`;
  return (
    <div className="mt-1">
      <CardHeader file={file} collapsed={collapsed} onToggle={toggleCollapsed} />
      {!collapsed && (
        <div className="group/att relative mt-0.5 w-fit">
          <button data-testid={`file-${file.name}`} className="block" onClick={() => setLightbox(true)} title={file.name}>
            {/* ~2x preview (ui_nits item 1). Thumbs cap at 512px, so an img
                never stretches past its intrinsic size — large images land at
                512 CSS px (soft on retina; noted at review). */}
            <AuthImg path={imgPath} alt={file.name} className="max-h-[480px] max-w-[min(576px,100%)] rounded-lg border border-hairline" />
          </button>
          <DownloadHoverButton file={file} onDownload={download} />
        </div>
      )}
      {lightbox && <ImageLightbox file={file} onClose={() => setLightbox(false)} onDownload={download} />}
    </div>
  );
}

/** Inline video card (ui_nits): preview-card chrome (collapse chevron, hover
 * Download) + native <video> controls, expand affordance opens a lightbox.
 * Prefers a presigned streaming URL (R2 serves Range, so the browser streams
 * and seeks without downloading the file — videos can be hundreds of MB);
 * falls back to whole-blob fetch when the server can't presign (local dev,
 * legacy rows). On error with a streamed URL we re-mint once — the TTL may
 * simply have expired in a long-open tab. */
function VideoAttachment({ file }: { file: FileDTO }) {
  const [collapsed, toggleCollapsed] = useCollapsed(file.id);
  const [url, setUrl] = useState<string | null>(null);
  const [streamed, setStreamed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retried, setRetried] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const download = useDownload(file);

  useEffect(() => {
    let alive = true;
    void fileStreamUrl(file.id)
      .then((r) => {
        if (!alive) return null;
        if (r.url) {
          setStreamed(true);
          setUrl(r.url);
          return null;
        }
        return blobUrl(`/v1/files/${file.id}`).then((u) => { if (alive) setUrl(u); });
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file.id]);

  const onVideoError = () => {
    if (streamed && !retried) {
      setRetried(true);
      setUrl(null);
      void fileStreamUrl(file.id)
        .then((r) => (r.url ? setUrl(r.url) : setFailed(true)))
        .catch(() => setFailed(true));
      return;
    }
    setFailed(true);
  };

  // Browser can't fetch or decode this video (codec/container) → plain chip.
  if (failed) return <FileChip file={file} />;

  return (
    <div className="mt-1">
      <CardHeader file={file} collapsed={collapsed} onToggle={toggleCollapsed} />
      {!collapsed && (
        <div className="group/att relative mt-0.5 w-fit">
          {url ? (
            <video
              data-testid={`file-video-${file.name}`}
              src={url}
              controls
              preload="metadata"
              className="max-h-[480px] max-w-[min(576px,100%)] rounded-lg border border-hairline bg-black"
              onError={onVideoError}
            />
          ) : (
            <div className="flex h-[240px] w-[min(426px,100%)] items-center justify-center rounded-lg border border-hairline bg-daypill text-2xl text-faint">
              ▶
            </div>
          )}
          <button
            data-testid={`file-video-expand-${file.name}`}
            className="absolute top-1.5 right-10 z-10 hidden h-7 w-7 items-center justify-center rounded-lg border border-hairline bg-white/90 text-sm shadow-sm hover:bg-white group-hover/att:flex"
            title="Expand"
            onClick={() => setLightbox(true)}
          >
            ⤢
          </button>
          <DownloadHoverButton file={file} onDownload={download} />
        </div>
      )}
      {lightbox && url && (
        <VideoLightbox file={file} url={url} onClose={() => setLightbox(false)} onDownload={download} />
      )}
    </div>
  );
}

/** Full-window video player overlay, matching the image lightbox chrome. */
function VideoLightbox({
  file,
  url,
  onClose,
  onDownload,
}: {
  file: FileDTO;
  url: string;
  onClose: () => void;
  onDownload: () => Promise<void>;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      data-testid="video-lightbox"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/75"
      onMouseDown={onClose}
    >
      <div className="absolute top-4 right-5 flex gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
        <button
          data-testid="video-lightbox-download"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30"
          title="Download"
          onClick={() => void onDownload()}
        >
          <DownloadIcon size={14} />
        </button>
        <button
          data-testid="video-lightbox-close"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30"
          title="Close"
          onClick={onClose}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <video
        src={url}
        controls
        autoPlay
        className="max-h-[85vh] max-w-[88vw] rounded-lg bg-black"
        onMouseDown={(e) => e.stopPropagation()}
      />
      <span className="mt-3 max-w-[80vw] truncate text-xs text-white/70" onMouseDown={(e) => e.stopPropagation()}>
        {file.name}
      </span>
    </div>
  );
}

/** Inline monospace preview for text-ish files (phase 6): first lines +
 * Expand, expanded output capped with a visible truncation notice. */
function TextAttachment({ file }: { file: FileDTO }) {
  const [collapsed, toggleCollapsed] = useCollapsed(file.id);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const download = useDownload(file);

  useEffect(() => {
    let alive = true;
    void fileText(`/v1/files/${file.id}`)
      .then((t) => { if (alive) setText(t); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file.id]);

  if (failed) return <FileChip file={file} />;

  const lines = text === null ? [] : text.split('\n');
  const preview = lines.slice(0, TEXT_PREVIEW_LINES).join('\n');
  const canExpand = text !== null && text.length > preview.length;
  const expandTruncated = text !== null && text.length > TEXT_EXPAND_MAX;
  const shown = text === null ? 'Loading…' : expanded ? text.slice(0, TEXT_EXPAND_MAX) : preview;

  return (
    <div className="mt-1 max-w-[560px]">
      <CardHeader file={file} collapsed={collapsed} onToggle={toggleCollapsed} />
      {!collapsed && (
        <div className="mt-0.5">
          <div className="group/att relative">
            <pre
              data-testid={`file-text-${file.name}`}
              className="mc-scroll overflow-x-auto rounded-lg border border-hairline bg-white px-3 py-2 font-mono text-[11px] leading-4 whitespace-pre text-ink"
            >
              {shown}
            </pre>
            <DownloadHoverButton file={file} onDownload={download} />
          </div>
          {expanded && expandTruncated && (
            <p className="mt-0.5 text-[11px] text-faint">Showing the first 100 KB — download for the full file.</p>
          )}
          {canExpand && (
            <button
              data-testid={`file-text-expand-${file.name}`}
              className="mt-0.5 text-xs font-semibold text-accent-soft hover:underline"
              onClick={() => setExpanded((v) => !v)}
            >
              <span className="flex items-center gap-1">
                {expanded ? 'Collapse' : 'Expand'}
                {expanded ? <ChevronUpIcon size={11} /> : <ChevronDownIcon size={11} />}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Mid-size PDF preview via the browser's native renderer (phase 6 ruling:
 * no pdf.js dependency); click opens the in-app full reader. */
function PdfAttachment({ file }: { file: FileDTO }) {
  const [collapsed, toggleCollapsed] = useCollapsed(file.id);
  const [url, setUrl] = useState<string | null>(null);
  const [reader, setReader] = useState(false);
  const download = useDownload(file);

  useEffect(() => {
    let alive = true;
    void blobUrl(`/v1/files/${file.id}`).then((u) => { if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
  }, [file.id]);

  return (
    <div className="mt-1">
      <CardHeader file={file} collapsed={collapsed} onToggle={toggleCollapsed} />
      {!collapsed && (
        <div className="group/att relative mt-0.5 h-[400px] w-[min(320px,100%)]">
          {url ? (
            <embed
              src={`${url}#toolbar=0&navpanes=0`}
              type="application/pdf"
              className="h-full w-full rounded-lg border border-hairline"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-lg border border-hairline bg-white text-xs text-faint">
              Loading…
            </div>
          )}
          {/* the embed swallows clicks — a transparent overlay opens the reader */}
          <button
            data-testid={`file-${file.name}`}
            className="absolute inset-0 cursor-pointer"
            title={`Open ${file.name}`}
            onClick={() => setReader(true)}
          />
          <DownloadHoverButton file={file} onDownload={download} />
        </div>
      )}
      {reader && url && (
        <PdfReader file={file} url={url} onClose={() => setReader(false)} onDownload={download} />
      )}
    </div>
  );
}

/** In-app full PDF reader overlay (browser viewer, toolbar enabled). */
function PdfReader({
  file,
  url,
  onClose,
  onDownload,
}: {
  file: FileDTO;
  url: string;
  onClose: () => void;
  onDownload: () => Promise<void>;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      data-testid="pdf-reader"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/75"
      onMouseDown={onClose}
    >
      <div className="absolute top-4 right-5 flex gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
        <button
          data-testid="pdf-reader-open-external"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30"
          title="Open external"
          onClick={() => window.open(url, '_blank')}
        >
          <ExternalIcon size={14} />
        </button>
        <button
          data-testid="pdf-reader-download"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30"
          title="Download"
          onClick={() => void onDownload()}
        >
          <DownloadIcon size={14} />
        </button>
        <button
          data-testid="pdf-reader-close"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30"
          title="Close"
          onClick={onClose}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="h-[90vh] w-[80vw]" onMouseDown={(e) => e.stopPropagation()}>
        <embed src={url} type="application/pdf" className="h-full w-full rounded-lg" />
      </div>
      <span className="mt-2 max-w-[80vw] truncate text-xs text-white/70" onMouseDown={(e) => e.stopPropagation()}>
        {file.name}
      </span>
    </div>
  );
}

function FileChip({ file }: { file: FileDTO }) {
  const download = useDownload(file);
  return (
    <div className="group/att relative mt-1 w-fit">
      <button
        data-testid={`file-${file.name}`}
        className="flex items-center gap-2 rounded-[10px] border border-hairline bg-white py-2 pr-10 pl-3 text-left text-sm hover:border-hairline2"
        onClick={() => void download()}
      >
        <span className="text-ink-soft"><DocIcon size={18} /></span>
        <span>
          <span className="block font-medium">{file.name}</span>
          <span className="block text-xs text-muted">{bytesLabel(file.sizeBytes)}</span>
        </span>
      </button>
      <button
        data-testid={`file-download-${file.name}`}
        className="absolute top-1/2 right-2 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-sm text-faint hover:bg-daypill hover:text-ink group-hover/att:flex"
        title="Download"
        onClick={() => void download()}
      >
        <DownloadIcon size={14} />
      </button>
    </div>
  );
}

/** In-app image popup (phase 5 item 5): original file, open-external + download icons. */
function ImageLightbox({
  file,
  onClose,
  onDownload,
}: {
  file: FileDTO;
  onClose: () => void;
  onDownload: () => Promise<void>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void blobUrl(`/v1/files/${file.id}`).then((u) => { if (alive) setUrl(u); }).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      document.removeEventListener('keydown', onKey);
    };
  }, [file.id, onClose]);
  return (
    <div
      data-testid="lightbox"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/75"
      onMouseDown={onClose}
    >
      <div className="absolute top-4 right-5 flex gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
        <button
          data-testid="lightbox-open-external"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30"
          title="Open external"
          onClick={() => { if (url) window.open(url, '_blank'); }}
        >
          <ExternalIcon size={14} />
        </button>
        <button
          data-testid="lightbox-download"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30"
          title="Download"
          onClick={() => void onDownload()}
        >
          <DownloadIcon size={14} />
        </button>
        <button
          data-testid="lightbox-close"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/30"
          title="Close"
          onClick={onClose}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      {url ? (
        <img
          src={url}
          alt={file.name}
          className="max-h-[85vh] max-w-[88vw] rounded-lg object-contain"
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="text-sm text-white/70">Loading…</span>
      )}
      <span className="mt-3 max-w-[80vw] truncate text-xs text-white/70" onMouseDown={(e) => e.stopPropagation()}>
        {file.name}
      </span>
    </div>
  );
}
