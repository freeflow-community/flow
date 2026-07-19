import { useMemo, useRef, useState } from 'react';
import { useSelection } from '../state';
import { useNameMap, useThread } from '../hooks';
import MessageList from './MessageList';
import Composer from './Composer';

// Thread panel width (phase 5 item 6): local per-device preference, like the sidebar.
const WIDTH_KEY = 'flow.threadWidth';
const DEFAULT_WIDTH = 384;
const clampWidth = (w: number) => Math.min(560, Math.max(280, w));
function storedWidth(): number {
  const w = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(w) && w > 0 ? clampWidth(w) : DEFAULT_WIDTH;
}

export default function ThreadPanel({ rootId }: { rootId: string }) {
  const sel = useSelection();
  const thread = useThread(rootId);
  const names = useNameMap(sel.workspaceId);
  const [width, setWidth] = useState(storedWidth);
  const dragRef = useRef<{ x: number; w: number } | null>(null);

  const messages = useMemo(() => {
    if (!thread.data) return [];
    return [thread.data.root, ...thread.data.messages];
  }, [thread.data]);

  const channelId = thread.data?.root.channelId;

  return (
    <aside
      data-testid="thread-panel"
      className="relative flex shrink-0 flex-col border-l border-hairline"
      style={{ width }}
    >
      {/* Left-edge drag handle: dragging left widens the panel. */}
      <div
        data-testid="thread-resizer"
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-accent/30"
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
      <MessageList
        messages={messages}
        names={names}
        hasMore={false}
        onLoadOlder={() => {}}
        showThreadAffordances={false}
      />
      {channelId && (
        <Composer channelId={channelId} threadRootId={rootId} placeholder="Reply in thread" />
      )}
    </aside>
  );
}
