import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sidebarColor } from '@flow/shared';
import type { ArtifactDTO, ChannelDTO, WorkspaceMemberDTO } from '@flow/shared';
import { api } from '../lib/api';
import { fileGlyph } from '../lib/fileKind';
import { workspaceExit } from '../lib/workspaceExit';
import { ACTIVITY_VIEW_ID, ADMIN_VIEW_ID, useAuth, useLive, useMobileNav, useSelection } from '../state';
import { useArtifacts, useChannels, useDisplayNameMap, useMemberMap, useMembers, useNameMap, useWorkspaces } from '../hooks';
import {
  ChannelMenu,
  CreateChannelModal,
  DeleteWorkspaceModal,
  InviteModal,
  LeaveWorkspaceModal,
  NewDmModal,
  WorkspaceColorModal,
} from './modals';
import { AppsModal } from './AppsModal';
import { AgentsModal } from './AgentsModal';
import { EmojiModal } from './EmojiModal';
import { InviteAgentModal } from './InviteAgentModal';
import { FeaturesModal } from './FeaturesModal';
import { useHoverTooltip } from './HoverTooltip';
import StatusFooter from './StatusPicker';
import { AuthImg } from './Avatar';

// Sidebar width (phase 3.5 ruling 5): local per-device preference.
/**
 * Sub-channels (#118): flatten the channel list into display order — each
 * parent immediately followed by its children, indented one level.
 *
 * Membership is per channel, so you can be in a child without being in its
 * parent. Such a child has nowhere to nest under, and hiding it would lose a
 * channel you belong to, so it renders at top level instead. That is also what
 * happens when the parent is archived.
 *
 * Input order is preserved (the server sorts by name), so parents stay
 * alphabetical and so do children within a parent.
 *
 * Only a top-level channel can host children. The server rejects grandchildren,
 * but one arriving anyway (an old row, a future rule change) renders at top
 * level rather than being indented twice or — worse — silently dropped.
 */
export function nestChannels(list: ChannelDTO[]): { channel: ChannelDTO; nested: boolean }[] {
  const byId = new Map(list.map((c) => [c.id, c]));
  const parentOf = (c: ChannelDTO) => (c.parentId ? byId.get(c.parentId) : undefined);
  const childrenOf = new Map<string, ChannelDTO[]>();
  const roots: ChannelDTO[] = [];
  for (const c of list) {
    const parent = parentOf(c);
    if (parent && !parentOf(parent)) {
      childrenOf.set(parent.id, [...(childrenOf.get(parent.id) ?? []), c]);
    } else {
      roots.push(c);
    }
  }
  return roots.flatMap((c) => [
    { channel: c, nested: false },
    ...(childrenOf.get(c.id) ?? []).map((k) => ({ channel: k, nested: true })),
  ]);
}

/**
 * Minimal scroll (#319): how far the sidebar must move to bring a row into
 * view, in scrollTop pixels. Zero when the row is already fully visible — that
 * is what keeps clicking a channel in the sidebar from jumping the list.
 *
 * All three arguments are relative to the scroll viewport: `rowTop` is the
 * row's top edge measured from the viewport's top edge (negative = above the
 * fold). A row taller than the viewport aligns to its top rather than its
 * bottom, so you see the start of it.
 */
export function nearestScrollDelta(rowTop: number, rowHeight: number, viewHeight: number): number {
  if (rowTop < 0 || rowHeight > viewHeight) return rowTop;
  const overshoot = rowTop + rowHeight - viewHeight;
  return overshoot > 0 ? overshoot : 0;
}

/**
 * Scroll a sidebar row into view within the sidebar's own scroller. Deliberately
 * not `Element.scrollIntoView`, which also scrolls every scrollable ancestor —
 * here only the channel list should move.
 */
function scrollRowIntoView(row: HTMLElement) {
  const view = row.closest('[data-sidebar-scroll]') as HTMLElement | null;
  if (!view) return;
  const r = row.getBoundingClientRect();
  const v = view.getBoundingClientRect();
  const delta = nearestScrollDelta(r.top - v.top, r.height, v.height);
  if (delta !== 0) view.scrollTop += delta;
}

const WIDTH_KEY = 'flow.sidebarWidth';
const DEFAULT_WIDTH = 240;
const clampWidth = (w: number) => Math.min(360, Math.max(180, w));
function storedWidth(): number {
  const w = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(w) && w > 0 ? clampWidth(w) : DEFAULT_WIDTH;
}

export function dmTitle(c: ChannelDTO, names: Record<string, string>, me: string): string {
  const others = (c.memberIds ?? []).filter((id) => id !== me);
  if (others.length === 0) return `${names[me] ?? 'You'} (you)`; // persistent self-DM
  return others.map((id) => names[id] ?? 'Unknown').sort().join(', ');
}

/** Agents section: collapsed or not, remembered per device (like the width). */
const AGENTS_COLLAPSED_KEY = 'flow.sidebarAgentsCollapsed';

export type AgentEntry = { member: WorkspaceMemberDTO; channel?: ChannelDTO };

/**
 * The Agents section (#361): every agent in the workspace gets a row between
 * Channels and Direct messages, whether or not a DM with it exists yet. The
 * agent's 1:1 DM moves up here with it — an agent is listed once, never twice.
 *
 * A *group* DM that happens to include an agent stays under Direct messages:
 * it's a conversation with several people, not a way to reach the agent. So is
 * the self-DM, even if you are yourself an agent.
 */
export function splitAgents(
  dms: ChannelDTO[],
  members: WorkspaceMemberDTO[],
  me: string,
): { agents: AgentEntry[]; rest: ChannelDTO[] } {
  const agentIds = new Set(members.filter((m) => m.isAgent && m.userId !== me).map((m) => m.userId));
  const dmWith = new Map<string, ChannelDTO>();
  const rest: ChannelDTO[] = [];
  for (const c of dms) {
    const others = (c.memberIds ?? []).filter((id) => id !== me);
    const only = others.length === 1 ? others[0] : undefined;
    const agentId = c.kind === 'dm' && only && agentIds.has(only) ? only : null;
    // Duplicate 1:1 rows shouldn't exist (the server dedupes by member set),
    // but if one ever does, the extra stays under Direct messages rather than
    // vanishing.
    if (agentId && !dmWith.has(agentId)) dmWith.set(agentId, c);
    else rest.push(c);
  }
  const agents = members
    .filter((m) => agentIds.has(m.userId))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
    .map((member) => ({ member, channel: dmWith.get(member.userId) }));
  return { agents, rest };
}

export default function Sidebar() {
  const auth = useAuth();
  const sel = useSelection();
  const live = useLive();
  const qc = useQueryClient();
  const workspaces = useWorkspaces();
  const channels = useChannels(sel.workspaceId);
  const artifacts = useArtifacts(sel.workspaceId);
  const members = useMembers(sel.workspaceId);
  const memberMap = useMemberMap(sel.workspaceId);
  const names = useNameMap(sel.workspaceId);
  const displayNames = useDisplayNameMap(sel.workspaceId); // agent names carry the 🤖 badge
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);
  const [showColor, setShowColor] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  const [showDeleteWs, setShowDeleteWs] = useState(false);
  const [showApps, setShowApps] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [showInviteAgent, setShowInviteAgent] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);
  const [menuChannel, setMenuChannel] = useState<ChannelDTO | null>(null);
  const [width, setWidth] = useState(storedWidth);
  const [agentsCollapsed, setAgentsCollapsed] = useState(
    () => localStorage.getItem(AGENTS_COLLAPSED_KEY) === '1',
  );
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  const wsMenuRef = useRef<HTMLDivElement>(null);
  // Inside the mobile drawer the sidebar fills whatever the rail leaves, so
  // the stored desktop width (and its drag handle) sit this one out.
  const { isMobile } = useMobileNav();

  // Dismiss the workspace dropdown on outside click or Escape
  // (QA w7g2 finding: it previously only closed via the trigger).
  useEffect(() => {
    if (!wsMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wsMenuRef.current && !wsMenuRef.current.contains(e.target as Node)) setWsMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWsMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [wsMenuOpen]);

  const ws = (workspaces.data ?? []).find((w) => w.id === sel.workspaceId);
  const isAdmin = ws?.role === 'owner' || ws?.role === 'admin';
  // Which way out this workspace offers — see lib/workspaceExit, which is
  // mirrored in Swift and holds the "roster not loaded yet" rule.
  const exit = workspaceExit(ws?.role, members.data, auth.user.id);
  const color = sidebarColor(ws?.sidebarColor);

  // Restored-workspace guard + default channel: a stale persisted workspace id
  // falls back to the chooser; a workspace opened with no channel selected
  // lands on #general (phase 3.5 fixes).
  useEffect(() => {
    if (workspaces.data && sel.workspaceId && !workspaces.data.some((w) => w.id === sel.workspaceId)) {
      sel.selectWorkspace(null);
    }
  }, [workspaces.data, sel]);
  useEffect(() => {
    if (sel.channelId || !channels.data) return;
    const general = channels.data.find((c) => c.isMember && c.name === 'general');
    const fallback = channels.data.find((c) => c.isMember && c.kind === 'standard');
    const target = general ?? fallback;
    if (target) sel.selectChannel(target.id);
  }, [channels.data, sel]);

  // Persistent self-DM: ensure "<Name> (you)" always exists under Direct
  // Messages (upsert — the server dedupes by dm_key, so this is idempotent).
  const ensuredSelfDm = useRef<string | null>(null);
  useEffect(() => {
    const wsId = sel.workspaceId;
    if (!wsId || !channels.data || ensuredSelfDm.current === wsId) return;
    const haveSelf = channels.data.some(
      (c) => c.kind === 'dm' && (c.memberIds ?? []).every((id) => id === auth.user.id),
    );
    if (haveSelf) { ensuredSelfDm.current = wsId; return; }
    ensuredSelfDm.current = wsId;
    void api('POST', `/v1/workspaces/${wsId}/dms`, { userIds: [auth.user.id] })
      .then(() => qc.invalidateQueries({ queryKey: ['channels', wsId] }))
      .catch(() => { ensuredSelfDm.current = null; });
  }, [sel.workspaceId, channels.data, auth.user.id, qc]);

  const openDm = async (userId: string) => {
    if (!sel.workspaceId) return;
    const ch = await api<ChannelDTO>('POST', `/v1/workspaces/${sel.workspaceId}/dms`, { userIds: [userId] });
    await qc.invalidateQueries({ queryKey: ['channels', sel.workspaceId] });
    sel.selectChannel(ch.id);
  };
  const all = channels.data ?? [];
  const dms = all.filter((c) => c.isMember && c.kind !== 'standard');
  // A sub-channel of a DM (an agent's log channel, say) belongs to that
  // conversation, not to the workspace — so it renders under its DM row down in
  // Direct Messages and is kept out of Channels entirely.
  const dmIds = new Set(dms.map((c) => c.id));
  const dmChildren = new Map<string, ChannelDTO[]>();
  for (const c of all) {
    if (c.isMember && c.kind === 'standard' && c.parentId && dmIds.has(c.parentId)) {
      dmChildren.set(c.parentId, [...(dmChildren.get(c.parentId) ?? []), c]);
    }
  }
  const joined = nestChannels(
    all.filter((c) => c.isMember && c.kind === 'standard' && !(c.parentId && dmIds.has(c.parentId))),
  );
  // The self-DM ("<you> (you)") is a personal scratchpad — it never carries an
  // unread badge (ui_nits): you can't have unread messages from yourself.
  const isSelfDm = (c: ChannelDTO) =>
    c.kind === 'dm' && (c.memberIds ?? []).every((id) => id === auth.user.id);
  // Phase 13: artifacts nest under their channel. Group the (newest-first) list
  // by channelId so each channel row can render its pinned artifacts beneath it.
  const artifactsByChannel = new Map<string, ArtifactDTO[]>();
  for (const a of artifacts.data ?? []) {
    const list = artifactsByChannel.get(a.channelId);
    if (list) list.push(a);
    else artifactsByChannel.set(a.channelId, [a]);
  }
  const browsable = all.filter((c) => !c.isMember && !c.isPrivate && c.kind === 'standard');
  // Agents live in their own section between Channels and Direct messages
  // (#361) — every workspace agent, with or without an existing DM. The ones
  // that have a DM take it with them, so nobody is listed twice.
  const { agents, rest: dmList } = splitAgents(dms, Object.values(memberMap), auth.user.id);
  // Direct messages is ONE alphabetically-sorted list (ui_nits). The self-DM
  // ("<you> (you)") is always pinned last: it's a personal scratchpad, not a
  // conversation, so it sinks below everyone else.
  const dmItems = dmList
    .map((c) => ({ title: dmTitle(c, displayNames, auth.user.id), self: isSelfDm(c), channel: c }))
    .sort((a, b) =>
      a.self !== b.self
        ? Number(a.self) - Number(b.self)
        : a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    );

  return (
    <aside
      className="relative flex shrink-0 flex-col text-white max-md:min-w-0 max-md:grow max-md:basis-0"
      style={{
        width: isMobile ? undefined : width,
        background: `linear-gradient(to bottom, ${color.top}, ${color.bottom})`,
      }}
    >
      <div ref={wsMenuRef} className="relative flex items-center justify-between px-3.5 pt-5 pb-2">
        <button
          data-testid="workspace-menu"
          className="flex min-w-0 items-center gap-1 rounded px-1 text-left text-base font-bold hover:bg-white/10"
          onClick={() => setWsMenuOpen((v) => !v)}
        >
          {ws?.avatarUrl && (
            <AuthImg path={ws.avatarUrl} alt={ws.name} className="h-5 w-5 shrink-0 rounded object-cover" />
          )}
          <span className="truncate">{ws?.name ?? 'Workspace'}</span>
          <span className="text-xs text-white/55">▾</span>
        </button>
        {wsMenuOpen && (
          <div className="absolute top-12 left-3 right-3 z-20 rounded-lg bg-white py-1 text-ink shadow-[0_12px_40px_rgba(20,8,40,.4)]">
            {(workspaces.data ?? []).map((w) => (
              <MenuItem key={w.id} onClick={() => { setWsMenuOpen(false); sel.selectWorkspace(w.id); }}>
                {w.id === sel.workspaceId ? '✓ ' : ''}{w.name}
              </MenuItem>
            ))}
            <hr className="my-1 border-hairline3" />
            <MenuItem testid="menu-invite" onClick={() => { setWsMenuOpen(false); setShowInvite(true); }}>
              Invite People…
            </MenuItem>
            {/* any member can sponsor agents (AGENT_MEMBERS.md) — the modal
                explains registration and lets sponsors remove their own */}
            <MenuItem testid="menu-agents" onClick={() => { setWsMenuOpen(false); setShowAgents(true); }}>
              Agents…
            </MenuItem>
            {isAdmin && (
              <>
                <MenuItem testid="menu-workspace-color" onClick={() => { setWsMenuOpen(false); setShowColor(true); }}>
                  Workspace appearance…
                </MenuItem>
                <MenuItem testid="menu-emoji" onClick={() => { setWsMenuOpen(false); setShowEmoji(true); }}>
                  Custom Emoji…
                </MenuItem>
                <MenuItem testid="menu-apps" onClick={() => { setWsMenuOpen(false); setShowApps(true); }}>
                  Manage Apps…
                </MenuItem>
                <MenuItem testid="menu-admin" onClick={() => { setWsMenuOpen(false); sel.openAdminPanel(); }}>
                  Manage Users…
                </MenuItem>
              </>
            )}
            <MenuItem onClick={() => { setWsMenuOpen(false); sel.selectWorkspace(null); }}>
              All Workspaces
            </MenuItem>
            {/* Leaving is self-service for everyone but the owner (#340). An
                owner with company has to hand the workspace over first; an
                owner on their own has nobody to hand it to, so they get to end
                it instead of staring at a permanently disabled row. */}
            {exit === 'delete' ? (
              <MenuItem
                testid="menu-delete-workspace"
                destructive
                onClick={() => { setWsMenuOpen(false); setShowDeleteWs(true); }}
              >
                Delete workspace…
              </MenuItem>
            ) : (
              <MenuItem
                testid="menu-leave-workspace"
                destructive
                disabled={exit === 'transferFirst'}
                title={exit === 'transferFirst' ? 'Transfer ownership first' : undefined}
                onClick={() => { setWsMenuOpen(false); setShowLeave(true); }}
              >
                Leave workspace
                {exit === 'transferFirst' && (
                  <span className="ml-1 text-ink/35">— transfer ownership first</span>
                )}
              </MenuItem>
            )}
            <hr className="my-1 border-hairline3" />
            <button
              data-testid="build-number"
              className="block w-full px-3 py-1 text-left text-xs text-ink/40 italic hover:bg-accent/10"
              title="What's new"
              onClick={() => { setWsMenuOpen(false); setShowFeatures(true); }}
            >
              Build {__BUILD__}
            </button>
          </div>
        )}
        <ActivityBell
          active={sel.channelId === ACTIVITY_VIEW_ID}
          unread={live.notificationUnread}
          onOpen={() => sel.selectChannel(ACTIVITY_VIEW_ID)}
        />
      </div>

      <div
        data-sidebar-scroll
        className="mc-scroll mc-scroll-dark min-h-0 flex-1 overflow-y-auto px-3.5 pb-2 text-sm"
      >
        {isAdmin && sel.adminPanelOpen && (
          <AdminRow
            active={sel.channelId === ADMIN_VIEW_ID}
            onOpen={() => sel.selectChannel(ADMIN_VIEW_ID)}
            onClose={() => sel.closeAdminPanel()}
          />
        )}

        <SectionHeader
          label="Channels"
          action={{
            label: '+',
            testid: 'sidebar-create-channel',
            title: 'Create a channel',
            onClick: () => setShowCreateChannel(true),
          }}
        />
        {joined.map(({ channel: c, nested }) => (
          <div key={c.id}>
            <ChannelRow channel={c} label={c.name ?? ''} nested={nested} onMenu={() => setMenuChannel(c)} />
            {(artifactsByChannel.get(c.id) ?? []).map((a) => (
              <ArtifactRow key={a.id} artifact={a} />
            ))}
          </div>
        ))}

        {/* Agents (#361): one row per workspace agent, above Direct messages.
            Collapsible, and hidden entirely in a workspace with no agents. */}
        {agents.length > 0 && (
          <>
            <SectionHeader
              label="Agents"
              collapsed={agentsCollapsed}
              onToggle={() => {
                const next = !agentsCollapsed;
                setAgentsCollapsed(next);
                localStorage.setItem(AGENTS_COLLAPSED_KEY, next ? '1' : '0');
              }}
            />
            {!agentsCollapsed &&
              agents.map(({ member: a, channel: c }) =>
                c ? (
                  // The agent's DM, rendered as the agent: same row as any DM,
                  // so unread badges, the working-here spinner and its
                  // sub-channels all come along.
                  <div key={c.id}>
                    <ChannelRow
                      channel={c}
                      testid={`sidebar-agent-${a.displayName}`}
                      label={a.displayName}
                      statusEmoji={a.statusEmoji}
                      statusTitle={a.statusText}
                      leading={<PresenceDot online={live.isOnline(a.userId)} />}
                      onMenu={() => setMenuChannel(c)}
                    />
                    {(artifactsByChannel.get(c.id) ?? []).map((x) => (
                      <ArtifactRow key={x.id} artifact={x} />
                    ))}
                    {(dmChildren.get(c.id) ?? []).map((k) => (
                      <div key={k.id}>
                        <ChannelRow channel={k} label={k.name ?? ''} nested onMenu={() => setMenuChannel(k)} />
                        {(artifactsByChannel.get(k.id) ?? []).map((x) => (
                          <ArtifactRow key={x.id} artifact={x} />
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  // No DM yet — a virtual row; clicking creates one.
                  <button
                    key={`agent-${a.userId}`}
                    data-testid={`sidebar-agent-${a.displayName}`}
                    title="Start a direct message"
                    className="flex w-full items-center gap-[9px] rounded-lg px-2 py-[7px] text-left text-white/80 hover:bg-white/10"
                    onClick={() => void openDm(a.userId)}
                  >
                    <PresenceDot online={live.isOnline(a.userId)} />
                    <span className="truncate">{a.displayName}</span>
                  </button>
                ),
              )}
          </>
        )}

        <SectionHeader
          label="Direct messages"
          action={{
            label: '+',
            testid: 'sidebar-new-dm',
            title: 'New direct message',
            onClick: () => setShowNewDm(true),
          }}
        />
        {dmItems.map((item) => {
          const c = item.channel;
          const title = dmTitle(c, names, auth.user.id);
          const otherId = (c.memberIds ?? []).find((id) => id !== auth.user.id);
          const status = otherId ? memberMap[otherId] : undefined;
          return (
            <div key={c.id}>
              <ChannelRow
                channel={c}
                testid={`sidebar-dm-${title}`}
                hideUnread={isSelfDm(c)}
                label={dmTitle(c, displayNames, auth.user.id)}
                statusEmoji={c.kind === 'dm' ? status?.statusEmoji : ''}
                statusTitle={c.kind === 'dm' ? status?.statusText : ''}
                leading={
                  c.kind === 'dm' ? (
                    // self-DM: you're online by definition (this client is connected)
                    <PresenceDot online={otherId ? live.isOnline(otherId) : true} />
                  ) : (
                    <span className="text-xs text-white/60">👥</span>
                  )
                }
                onMenu={() => setMenuChannel(c)}
              />
              {(artifactsByChannel.get(c.id) ?? []).map((a) => (
                <ArtifactRow key={a.id} artifact={a} />
              ))}
              {(dmChildren.get(c.id) ?? []).map((k) => (
                <div key={k.id}>
                  <ChannelRow channel={k} label={k.name ?? ''} nested onMenu={() => setMenuChannel(k)} />
                  {(artifactsByChannel.get(k.id) ?? []).map((a) => (
                    <ArtifactRow key={a.id} artifact={a} />
                  ))}
                </div>
              ))}
            </div>
          );
        })}

        {browsable.length > 0 && (
          <>
            <SectionHeader label="Browse" />
            {browsable.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg px-2 py-[7px] text-white/70">
                <span className="truncate"><span className="opacity-60"># </span>{c.name}</span>
                <button
                  className="text-xs font-semibold text-white/80 hover:text-white hover:underline"
                  onClick={async () => {
                    await api('POST', `/v1/channels/${c.id}/join`);
                    await qc.invalidateQueries({ queryKey: ['channels', sel.workspaceId] });
                    sel.selectChannel(c.id);
                  }}
                >
                  Join
                </button>
              </div>
            ))}
          </>
        )}

      </div>

      {/* Invite your Agent (phase 15): pinned above the profile footer — a
          slightly raised translucent CTA, noticeable without shouting. */}
      <div className="px-3.5 pt-2 pb-1.5">
        <button
          data-testid="invite-agent-button"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/35 bg-white/[0.18] px-3 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-white/25"
          onClick={() => setShowInviteAgent(true)}
        >
          <span aria-hidden>🤖</span>
          Invite your Agent
        </button>
      </div>

      <StatusFooter />

      <div
        data-testid="sidebar-resizer"
        className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize hover:bg-white/30 max-md:hidden"
        onPointerDown={(e) => {
          e.preventDefault();
          dragRef.current = { x: e.clientX, w: width };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (drag) setWidth(clampWidth(drag.w + e.clientX - drag.x));
        }}
        onPointerUp={(e) => {
          const drag = dragRef.current;
          if (!drag) return;
          dragRef.current = null;
          const final = clampWidth(drag.w + e.clientX - drag.x);
          setWidth(final);
          localStorage.setItem(WIDTH_KEY, String(final));
        }}
        onDoubleClick={() => {
          setWidth(DEFAULT_WIDTH);
          localStorage.setItem(WIDTH_KEY, String(DEFAULT_WIDTH));
        }}
      />

      {showCreateChannel && sel.workspaceId && (
        <CreateChannelModal workspaceId={sel.workspaceId} onClose={() => setShowCreateChannel(false)} />
      )}
      {showInvite && sel.workspaceId && <InviteModal workspaceId={sel.workspaceId} onClose={() => setShowInvite(false)} />}
      {showNewDm && sel.workspaceId && <NewDmModal workspaceId={sel.workspaceId} onClose={() => setShowNewDm(false)} />}
      {showColor && sel.workspaceId && <WorkspaceColorModal workspaceId={sel.workspaceId} onClose={() => setShowColor(false)} />}
      {showLeave && sel.workspaceId && (
        <LeaveWorkspaceModal workspaceId={sel.workspaceId} onClose={() => setShowLeave(false)} />
      )}
      {showDeleteWs && sel.workspaceId && (
        <DeleteWorkspaceModal workspaceId={sel.workspaceId} onClose={() => setShowDeleteWs(false)} />
      )}
      {showApps && sel.workspaceId && <AppsModal workspaceId={sel.workspaceId} onClose={() => setShowApps(false)} />}
      {showEmoji && sel.workspaceId && <EmojiModal workspaceId={sel.workspaceId} onClose={() => setShowEmoji(false)} />}
      {showAgents && sel.workspaceId && <AgentsModal workspaceId={sel.workspaceId} onClose={() => setShowAgents(false)} />}
      {showInviteAgent && sel.workspaceId && (
        <InviteAgentModal workspaceId={sel.workspaceId} onClose={() => setShowInviteAgent(false)} />
      )}
      {showFeatures && <FeaturesModal onClose={() => setShowFeatures(false)} />}
      {menuChannel && <ChannelMenu channel={menuChannel} onClose={() => setMenuChannel(null)} />}
    </aside>
  );
}

/**
 * The Activity feed's bell (#385) — fixed in the workspace header rather than
 * sitting at the top of the channel list, so it can never scroll out of view
 * and the list holds only real channels. Carries the notification unread badge
 * and shows a selected state while the Activity feed is the open view.
 */
export function ActivityBell({
  active,
  unread,
  onOpen,
}: {
  active: boolean;
  unread: number;
  onOpen: () => void;
}) {
  return (
    <button
      data-testid="sidebar-activity"
      data-unread={unread}
      data-active={active ? 'true' : 'false'}
      title="Activity"
      aria-label="Activity"
      aria-current={active ? 'page' : undefined}
      className={`relative ml-1 shrink-0 rounded-lg px-1.5 py-1 text-base leading-none ${
        active ? 'bg-white' : 'hover:bg-white/10'
      }`}
      onClick={onOpen}
    >
      <span className={active ? 'opacity-70' : 'opacity-75'}>🔔</span>
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 rounded-[9px] bg-unread px-[5px] py-px text-[10px] font-bold text-white">
          {Math.min(unread, 99)}
        </span>
      )}
    </button>
  );
}

/**
 * The admin panel's pinned sidebar row — a virtual, client-only entry (no real
 * channel). Selectable like a channel; the hover × closes it (pure UI hide,
 * reopen from the workspace menu). Only rendered for admins.
 */
function AdminRow({
  active,
  onOpen,
  onClose,
}: {
  active: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className={`group mt-1 flex items-center gap-[9px] rounded-lg px-2 py-[7px] ${
        active ? 'bg-white text-accent-deep' : 'hover:bg-white/10'
      }`}
    >
      <button
        data-testid="sidebar-admin"
        className="flex min-w-0 flex-1 items-center gap-[9px] text-left"
        onClick={onOpen}
      >
        <span className={active ? 'opacity-70' : 'text-white/60'}>🛡️</span>
        <span className={`truncate ${active ? 'font-[650]' : 'text-white/82'}`}>Manage users</span>
      </button>
      <button
        data-testid="sidebar-admin-close"
        title="Close"
        className={`hidden rounded px-1 text-xs group-hover:block ${
          active ? 'text-accent-deep/60 hover:text-accent-deep' : 'text-white/55 hover:text-white'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ✕
      </button>
    </div>
  );
}

/** An artifact row (phase 13): nested under its channel; selectable opens the
 * side panel; hover ✕ DELETES the shared artifact (and its own file, if the
 * artifact owns it — server-side). */
function ArtifactRow({ artifact }: { artifact: ArtifactDTO }) {
  const sel = useSelection();
  const qc = useQueryClient();
  const active = sel.artifactId === artifact.id;
  return (
    // No white pill for the active artifact — it would stack under the active
    // channel's pill (double-highlight). Selection reads as bold white text.
    <div className="group ml-3 flex items-center gap-[9px] rounded-lg px-2 py-[5px] hover:bg-white/10">
      <button
        data-testid={`sidebar-artifact-${artifact.name}`}
        className="flex min-w-0 flex-1 items-center gap-[9px] text-left"
        onClick={() => sel.selectArtifact(artifact.id)}
      >
        <span className={active ? 'text-white' : 'text-white/60'}>{fileGlyph(artifact.file)}</span>
        <span className={`truncate ${active ? 'font-bold text-white' : 'text-white/82'}`}>{artifact.name}</span>
      </button>
      <button
        data-testid={`sidebar-artifact-remove-${artifact.name}`}
        title="Remove artifact"
        className="hidden rounded px-1 text-xs text-white/55 hover:text-white group-hover:block"
        onClick={(e) => {
          e.stopPropagation();
          void api('DELETE', `/v1/artifacts/${artifact.id}`).then(() => {
            if (active) sel.selectArtifact(null);
            return qc.invalidateQueries({ queryKey: ['artifacts', artifact.workspaceId] });
          });
        }}
      >
        ✕
      </button>
    </div>
  );
}

function PresenceDot({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${online ? 'bg-online' : 'border-[1.5px] border-white/40'}`}
    />
  );
}

function SectionHeader({
  label,
  action,
  collapsed,
  onToggle,
}: {
  label: string;
  action?: { label: string; testid: string; title: string; onClick: () => void };
  /** Collapsible section (#361): the label becomes a toggle with a caret. */
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="mt-4 mb-1 flex items-center justify-between px-2 first:mt-1">
      {onToggle ? (
        <button
          data-testid={`sidebar-section-${label.toLowerCase()}`}
          aria-expanded={!collapsed}
          className="flex items-center gap-1 rounded text-[11px] font-semibold tracking-[.06em] text-white/55 uppercase hover:text-white/80"
          onClick={onToggle}
        >
          <span className="text-[9px]" aria-hidden>{collapsed ? '▸' : '▾'}</span>
          {label}
        </button>
      ) : (
        <span className="text-[11px] font-semibold tracking-[.06em] text-white/55 uppercase">{label}</span>
      )}
      {action && (
        <button
          data-testid={action.testid}
          className="rounded px-1 text-white/55 hover:bg-white/10 hover:text-white"
          onClick={action.onClick}
          title={action.title}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * "Someone is working in here" (#137) — a small ring at the end of the channel
 * label while an agent has this channel's indicator set. Deliberately quiet: no
 * colour of its own, no layout shift, and it stops moving under
 * prefers-reduced-motion (the ring alone still reads as busy).
 */
export function ActivitySpinner({ active }: { active: boolean }) {
  return (
    <span
      data-testid="channel-indicator"
      title="an agent is working in this channel"
      className={`h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none ${
        active ? 'opacity-50' : 'text-white/60'
      }`}
    />
  );
}

function ChannelRow({
  channel,
  label,
  leading,
  statusEmoji,
  statusTitle,
  testid,
  hideUnread,
  nested,
  onMenu,
}: {
  channel: ChannelDTO;
  label: string;
  leading?: React.ReactNode;
  statusEmoji?: string;
  statusTitle?: string;
  testid?: string;
  hideUnread?: boolean;
  /** Sub-channel (#118) — indented under its parent, same as ArtifactRow. */
  nested?: boolean;
  onMenu: () => void;
}) {
  const sel = useSelection();
  // The channel stays selected (and highlighted) even with an artifact tab open
  // in the side panel — the conversation is still shown behind it (phase 13).
  const active = sel.channelId === channel.id;
  // Two separate signals (operator ruling 2026-07-26): unread *messages* only
  // embolden the row — "something happened here". A *number* means "this needs
  // you", so it counts unread notifications (mentions, thread replies,
  // reactions; every message in a DM) and nothing else.
  const unread = channel.unreadCount > 0 && !hideUnread;
  const notifications = hideUnread ? 0 : channel.unreadNotifications;
  // Arriving at a channel by any route other than clicking it here — a
  // notification, a deep link, the switcher, being added to a channel — left the
  // sidebar wherever it was, so the row you just landed on could sit below the
  // fold (#319). Scroll it back into view, by the minimum needed: a row that is
  // already visible does not move, which is why a plain sidebar click still
  // never jumps.
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active && rowRef.current) scrollRowIntoView(rowRef.current);
  }, [active]);
  // #392: the topic on hover, so you can tell what a channel is for without
  // opening it. The hover target is the whole row, not the few dozen pixels the
  // name occupies — pointing at a channel means the row, and anchoring to the
  // row is also what keeps the bubble clear of it. No topic, no tooltip and no
  // handlers; DMs never have one, so they're inert here.
  const topicTip = useHoverTooltip(channel.topic, `channel-topic-tooltip-${channel.name ?? channel.id}`);
  const { ref: tipRef, ...tipHandlers } = topicTip.anchorProps;
  return (
    <div
      ref={(el) => {
        rowRef.current = el;
        tipRef(el);
      }}
      {...tipHandlers}
      data-nested={nested ? 'true' : undefined}
      className={`group flex items-center gap-[9px] rounded-lg px-2 py-[7px] ${nested ? 'ml-3' : ''} ${
        active ? 'bg-white text-accent-deep' : 'hover:bg-white/10'
      }`}
    >
      <button
        data-testid={testid ?? `sidebar-channel-${channel.name}`}
        data-unread={channel.unreadCount}
        data-notifications={notifications}
        className="flex min-w-0 flex-1 items-center gap-[9px] text-left"
        onClick={() => sel.selectChannel(channel.id)}
      >
        {leading ?? (
          <span className={active ? 'opacity-60' : 'text-white/60'}>{channel.isPrivate ? '🔒' : '#'}</span>
        )}
        <span
          className={`truncate ${
            active ? 'font-[650]' : unread ? 'font-[650] text-white' : 'text-white/82'
          }`}
        >
          {label}
        </span>
        {/* One slot, two tenants (#396): the spinner is a claim about right now,
            so it wins while it's up; the emoji is decoration and comes back the
            moment it clears. Never both — they'd read as one confused status. */}
        {channel.indicator ? (
          <ActivitySpinner active={active} />
        ) : (
          channel.emoji && (
            <span data-testid="channel-emoji" className="shrink-0 text-sm leading-none">
              {channel.emoji}
            </span>
          )
        )}
        {statusEmoji && (
          <span className="ml-0.5 shrink-0 text-sm" title={statusTitle}>{statusEmoji}</span>
        )}
        {channel.notifyLevel === 0 && <span className="text-xs opacity-60">🔕</span>}
        {notifications > 0 && (
          <span className="ml-auto rounded-[9px] bg-unread px-[7px] py-px text-[11px] font-bold text-white">
            {Math.min(notifications, 99)}
          </span>
        )}
      </button>
      <button
        data-testid={`channel-menu-${channel.name ?? channel.id}`}
        className={`hidden rounded px-1 text-xs group-hover:block ${
          active ? 'text-accent-deep/60 hover:text-accent-deep' : 'text-white/55 hover:text-white'
        }`}
        onClick={onMenu}
      >
        ⋯
      </button>
      {topicTip.tooltip}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  testid,
  destructive,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  testid?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Hover hint — how a disabled item explains itself. */
  title?: string;
}) {
  return (
    <button
      data-testid={testid}
      title={title}
      disabled={disabled}
      className={`block w-full px-3 py-1.5 text-left text-sm ${
        disabled
          ? 'cursor-default text-ink/35'
          : `${destructive ? 'text-red-600 hover:bg-red-50' : ''} hover:bg-accent/10`
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
