// Tabbed side panel (phase 13): the right-hand pane that hosts the open Thread,
// the channel's artifacts and its Files list (#347) as switchable tabs. It owns the panel chrome —
// width + left-edge resizer, the tab strip, and the panel close — and renders
// the active tab's body (ThreadPanel embedded, or an ArtifactBody). Threads and
// artifacts coexist; the tab strip picks which one shows.
//
// One body is an exception to "render the active tab": a link artifact's frame
// (the mini-browser / mini app) stays mounted but hidden when you switch to
// another tab, so Thread <-> app toggles don't reload the page through the
// tunnel and re-mint a token every time (#513). See `nextKeepAlive`.
import { useRef, useState, type ReactNode } from 'react';
import type { ArtifactDTO } from '@flow/shared';
import { artifactGlyph } from '../lib/fileKind';
import { threadParentLabel } from '../lib/channelTitle';
import { useAuth, useMobileNav, useSelection } from '../state';
import { useArtifacts, useChannels, useDisplayNameMap } from '../hooks';
import ThreadPanel from './ThreadPanel';
import ArtifactBody from './ArtifactView';
import FilesPanel from './FilesPanel';

const WIDTH_KEY = 'flow.sidePanelWidth';
const DEFAULT_WIDTH = 480;
const clampWidth = (w: number) => Math.min(760, Math.max(320, w));
function storedWidth(): number {
  const w = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(w) && w > 0 ? clampWidth(w) : DEFAULT_WIDTH;
}

export default function SidePanel() {
  const sel = useSelection();
  const auth = useAuth();
  const artifacts = useArtifacts(sel.workspaceId);
  const channels = useChannels(sel.workspaceId);
  const displayNames = useDisplayNameMap(sel.workspaceId);
  const [width, setWidth] = useState(storedWidth);
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  const { isMobile } = useMobileNav();

  // Tabs = the open thread (if any) + every artifact pinned in the active
  // channel, so you can switch to any of them.
  const channelArtifacts = (artifacts.data ?? []).filter((a) => a.channelId === sel.channelId);
  const threadActive = !sel.artifactId && !sel.filesOpen && !!sel.threadRootId;

  // Keep-alive slot (#513): the one link-artifact frame we hold mounted across
  // tab switches. Updated during render rather than in an effect on purpose —
  // an effect would commit one render with the body in the normal position and
  // then move it into the slot, and re-parenting an iframe reloads it, which is
  // the exact cost this is here to avoid.
  const [keepAlive, setKeepAlive] = useState<KeepAlive | null>(null);
  const selectedArtifact = sel.artifactId
    ? (channelArtifacts.find((a) => a.id === sel.artifactId) ?? null)
    : null;
  const nextAlive = nextKeepAlive(keepAlive, sel.channelId, selectedArtifact);
  if (nextAlive !== keepAlive) setKeepAlive(nextAlive);
  // Only kept alive while its tab still exists: an artifact deleted out from
  // under us drops the frame (and lets ArtifactBody clear the selection).
  const keptArtifact = nextAlive
    ? (channelArtifacts.find((a) => a.id === nextAlive.artifactId) ?? null)
    : null;
  const keptActive = !!keptArtifact && !sel.filesOpen && sel.artifactId === keptArtifact.id;

  // The thread tab says which conversation the thread belongs to (#417) —
  // "Thread in #factory" / "Thread with Ada". The name is its own tap target:
  // it goes to the parent channel, and on mobile (where the panel covers the
  // channel full-screen) that means getting the panel out of the way too.
  const parentChannel = (channels.data ?? []).find((c) => c.id === sel.channelId);
  const parent = threadParentLabel(parentChannel, displayNames, auth.user.id);
  const goToParent = () => {
    if (!sel.channelId) return;
    sel.selectChannel(sel.channelId);
    if (isMobile) sel.closeSidePanel();
  };

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
              suffix={
                parent && (
                  <>
                    <span className="shrink-0 text-muted">{parent.connector}</span>
                    <button
                      data-testid="side-tab-thread-parent"
                      className="truncate rounded text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                      title={`Go to ${parent.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        goToParent();
                      }}
                    >
                      {parent.name}
                    </button>
                  </>
                )
              }
              active={threadActive}
              onClick={() => sel.showThread()}
              onClose={() => sel.openThread(null)}
            />
          )}
          {sel.filesOpen && (
            <PanelTab
              testid="side-tab-files"
              icon="📎"
              label="Files"
              active={sel.filesOpen}
              onClick={() => sel.openFiles(true)}
              onClose={() => sel.openFiles(false)}
            />
          )}
          {channelArtifacts.map((a) => (
            <PanelTab
              key={a.id}
              testid={`side-tab-artifact-${a.name}`}
              icon={artifactGlyph(a)}
              label={a.name}
              active={!sel.filesOpen && sel.artifactId === a.id}
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

      {sel.filesOpen && sel.channelId ? (
        <FilesPanel key={sel.channelId} channelId={sel.channelId} />
      ) : sel.artifactId ? (
        // The kept-alive artifact renders in the slot below instead, so that it
        // keeps the same DOM parent whether it is showing or hidden.
        keptActive ? null : <ArtifactBody key={sel.artifactId} artifactId={sel.artifactId} />
      ) : sel.threadRootId ? (
        <ThreadPanel key={sel.threadRootId} rootId={sel.threadRootId} embedded />
      ) : null}

      {keptArtifact && (
        <div
          data-testid="side-panel-keepalive"
          data-active={keptActive ? 'true' : 'false'}
          className={keptActive ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}
        >
          <ArtifactBody key={keptArtifact.id} artifactId={keptArtifact.id} />
        </div>
      )}
    </aside>
  );
}

/** The link-artifact frame the panel holds mounted, and the channel it belongs
 * to (a frame is only worth keeping while you are still in its channel). */
export type KeepAlive = { channelId: string; artifactId: string };

/**
 * Which frame the side panel keeps mounted while another tab is showing (#513).
 *
 * Only link artifacts qualify: their frame costs a token mint and a full load
 * through the app tunnel to rebuild, while an image/text/PDF viewer re-reads a
 * cached blob. At most one is held — selecting another link replaces it — and
 * it is dropped as soon as the channel changes, which caps the memory a hidden
 * frame can hold. Selecting a *non*-link artifact keeps the previous frame:
 * that is the point, it is what you are coming back to.
 *
 * Returns `prev` unchanged (by identity) when nothing moved, so callers can
 * update state during render without looping.
 */
export function nextKeepAlive(
  prev: KeepAlive | null,
  channelId: string | null,
  selected: ArtifactDTO | null,
): KeepAlive | null {
  if (channelId && selected?.kind === 'link') {
    return prev && prev.channelId === channelId && prev.artifactId === selected.id
      ? prev
      : { channelId, artifactId: selected.id };
  }
  return prev && prev.channelId === channelId ? prev : null;
}

function PanelTab({
  icon,
  label,
  suffix,
  active,
  onClick,
  onClose,
  testid,
}: {
  icon: string;
  label: string;
  /** Secondary, independently clickable trailing text (the thread's parent
   * channel, #417). It sits outside the tab's own button — nesting one button
   * in another is invalid, and the two go to different places. */
  suffix?: ReactNode;
  active: boolean;
  onClick: () => void;
  onClose?: () => void;
  testid: string;
}) {
  return (
    <div
      className={`group flex h-8 ${suffix ? 'max-w-[280px]' : 'max-w-[180px]'} shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-2.5 ${
        active
          ? 'border-accent bg-base font-semibold text-ink'
          : 'border-transparent text-muted hover:bg-base/60 hover:text-ink'
      }`}
    >
      <button
        data-testid={testid}
        className={`flex items-center gap-1.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
          // With a suffix the tab must give *it* all the squeeze: an unpinned
          // button compresses below its own text and "Thread" runs into the
          // connector instead of truncating the channel name.
          suffix ? 'shrink-0' : 'min-w-0'
        }`}
        onClick={onClick}
        title={label}
      >
        <span className="shrink-0 text-sm">{icon}</span>
        {/* "Thread" is never truncated — only the channel name after it is. */}
        <span className={`text-[13px] ${suffix ? 'shrink-0 whitespace-nowrap' : 'truncate'}`}>
          {label}
        </span>
      </button>
      {suffix && <div className="flex min-w-0 items-center gap-1.5 text-[13px]">{suffix}</div>}
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
