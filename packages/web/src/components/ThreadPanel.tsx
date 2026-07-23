import { useMemo, useRef, useState } from 'react';
import { typingKey, useAuth, useLive, useMobileNav, useSelection } from '../state';
import { useMemberMap, useNameMap, useThread } from '../hooks';
import MessageList from './MessageList';
import Composer, { arrowUpEdit } from './Composer';

// Thread panel width (phase 5 item 6): local per-device preference, like the sidebar.
const WIDTH_KEY = 'flow.threadWidth';
const DEFAULT_WIDTH = 384;
const clampWidth = (w: number) => Math.min(560, Math.max(280, w));
function storedWidth(): number {
  const w = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(w) && w > 0 ? clampWidth(w) : DEFAULT_WIDTH;
}

export default function ThreadPanel({ rootId, embedded = false }: { rootId: string; embedded?: boolean }) {
  const auth = useAuth();
  const sel = useSelection();
  const thread = useThread(rootId);
  const live = useLive();
  const names = useNameMap(sel.workspaceId);
  const memberMap = useMemberMap(sel.workspaceId);
  const [width, setWidth] = useState(storedWidth);
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  // Mobile: the thread covers the channel full-screen (its ✕ closes it)
  // instead of splitting an already-narrow viewport into two columns.
  const { isMobile } = useMobileNav();

  const messages = useMemo(() => {
    if (!thread.data) return [];
    return [thread.data.root, ...thread.data.messages];
  }, [thread.data]);

  const channelId = thread.data?.root.channelId;

  // Typing in this thread's composer — scoped to the thread, so it appears
  // here and not in the channel behind it.
  const typingNames = Object.entries(channelId ? (live.typing[typingKey(channelId, rootId)] ?? {}) : {})
    .filter(([uid, ts]) => Date.now() - ts < 5000 && uid !== auth.user.id)
    .map(([uid]) => names[uid] ?? 'Someone');

  const body = (
    <>
      <MessageList
        key={rootId}
        messages={messages}
        names={names}
        membersById={memberMap}
        hasMore={false}
        onLoadOlder={() => {}}
        showThreadAffordances={false}
        focusMessageId={sel.focusMessageId}
        onFocused={() => sel.clearFocusMessage()}
      />
      <div className="h-5 px-4 text-xs text-muted" data-testid="thread-typing-indicator-slot">
        {typingNames.length === 1 && (
          <span data-testid="thread-typing-indicator">{typingNames[0]} is typing…</span>
        )}
        {typingNames.length > 1 && (
          <span data-testid="thread-typing-indicator">Several people are typing…</span>
        )}
      </div>

      {channelId && (
        <Composer
          channelId={channelId}
          threadRootId={rootId}
          placeholder="Reply in thread"
          onArrowUpEdit={arrowUpEdit(messages, auth.user.id, sel.setEditingMessage)}
        />
      )}
    </>
  );

  // Embedded in the tabbed side panel (phase 13): the container owns the aside,
  // width/resizer and tab strip, so drop our own chrome and just fill the slot.
  if (embedded) {
    return (
      <div data-testid="thread-panel" className="flex min-h-0 min-w-0 flex-1 flex-col">
        {body}
      </div>
    );
  }

  return (
    <aside
      data-testid="thread-panel"
      className="relative flex shrink-0 flex-col border-l border-hairline bg-base shadow-[-6px_0_16px_rgba(57,52,47,0.10)] max-md:fixed max-md:inset-0 max-md:z-30 max-md:border-l-0"
      style={isMobile ? undefined : { width }}
    >
      {/* Left-edge drag handle: dragging left widens the panel. */}
      <div
        data-testid="thread-resizer"
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-accent/30 max-md:hidden"
        onPointerDown={(e) => {
          e.preventDefault();
          dragRef.current = { x: e.clientX, w: width };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (drag) setWidth(clampWidth(drag.w + drag.x - e.clientX));
        }}
        onPointerUp={(e) => {
          const drag = dragRef.current;
          if (!drag) return;
          dragRef.current = null;
          const final = clampWidth(drag.w + drag.x - e.clientX);
          setWidth(final);
          localStorage.setItem(WIDTH_KEY, String(final));
        }}
        onDoubleClick={() => {
          setWidth(DEFAULT_WIDTH);
          localStorage.setItem(WIDTH_KEY, String(DEFAULT_WIDTH));
        }}
      />
      <header className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="font-bold">Thread</h3>
        <button
          data-testid="thread-close"
          className="rounded px-2 text-faint hover:bg-daypill hover:text-ink"
          onClick={() => sel.openThread(null)}
        >
          ✕
        </button>
      </header>
      {body}
    </aside>
  );
}
