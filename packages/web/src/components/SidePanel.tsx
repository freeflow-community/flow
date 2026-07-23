// Tabbed side panel (phase 13): the right-hand pane that hosts the open Thread
// and the channel's artifacts as switchable tabs. It owns the panel chrome —
// width + left-edge resizer, the tab strip, and the panel close — and renders
// the active tab's body (ThreadPanel embedded, or an ArtifactBody). Threads and
// artifacts coexist; the tab strip picks which one shows.
import { useRef, useState } from 'react';
import { fileGlyph } from '../lib/fileKind';
import { useMobileNav, useSelection } from '../state';
import { useArtifacts } from '../hooks';
import ThreadPanel from './ThreadPanel';
import ArtifactBody from './ArtifactView';

const WIDTH_KEY = 'flow.sidePanelWidth';
const DEFAULT_WIDTH = 480;
const clampWidth = (w: number) => Math.min(760, Math.max(320, w));
function storedWidth(): number {
  const w = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(w) && w > 0 ? clampWidth(w) : DEFAULT_WIDTH;
}

export default function SidePanel() {
  const sel = useSelection();
  const artifacts = useArtifacts(sel.workspaceId);
  const [width, setWidth] = useState(storedWidth);
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  const { isMobile } = useMobileNav();

  // Tabs = the open thread (if any) + every artifact pinned in the active
  // channel, so you can switch to any of them.
  const channelArtifacts = (artifacts.data ?? []).filter((a) => a.channelId === sel.channelId);
  const threadActive = !sel.artifactId && !!sel.threadRootId;

  return (
    <aside
      data-testid="side-panel"
      className="relative flex shrink-0 flex-col border-l border-hairline bg-base shadow-[-6px_0_16px_rgba(57,52,47,0.10)] max-md:fixed max-md:inset-0 max-md:z-30 max-md:border-l-0"
      style={isMobile ? undefined : { width }}
    >
      {/* Left-edge drag handle: dragging left widens the panel. */}
      <div
        data-testid="side-panel-resizer"
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

      <div className="flex h-11 shrink-0 items-center border-b border-hairline bg-daypill/40 pr-1">
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1.5">
          {sel.threadRootId && (
            <PanelTab
              testid="side-tab-thread"
              icon="💬"
              label="Thread"
              active={threadActive}
              onClick={() => sel.showThread()}
              onClose={() => sel.openThread(null)}
            />
          )}
          {channelArtifacts.map((a) => (
            <PanelTab
              key={a.id}
              testid={`side-tab-artifact-${a.name}`}
              icon={fileGlyph(a.file)}
              label={a.name}
              active={sel.artifactId === a.id}
              onClick={() => sel.selectArtifact(a.id)}
            />
          ))}
        </div>
        <button
          data-testid="side-panel-close"
          className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm text-faint outline-none hover:bg-daypill hover:text-ink focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
          title="Close panel"
          onClick={() => sel.closeSidePanel()}
        >
          ✕
        </button>
      </div>

      {sel.artifactId ? (
        <ArtifactBody key={sel.artifactId} artifactId={sel.artifactId} />
      ) : sel.threadRootId ? (
        <ThreadPanel key={sel.threadRootId} rootId={sel.threadRootId} embedded />
      ) : null}
    </aside>
  );
}

function PanelTab({
  icon,
  label,
  active,
  onClick,
  onClose,
  testid,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
  onClose?: () => void;
  testid: string;
}) {
  return (
    <div
      className={`group flex h-8 max-w-[180px] shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-2.5 ${
        active
          ? 'border-accent bg-base font-semibold text-ink'
          : 'border-transparent text-muted hover:bg-base/60 hover:text-ink'
      }`}
    >
      <button
        data-testid={testid}
        className="flex min-w-0 items-center gap-1.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
        onClick={onClick}
        title={label}
      >
        <span className="shrink-0 text-sm">{icon}</span>
        <span className="truncate text-[13px]">{label}</span>
      </button>
      {onClose && (
        <button
          data-testid={`${testid}-close`}
          className="hidden shrink-0 rounded px-0.5 text-xs text-faint outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 group-hover:block"
          title="Close thread"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
