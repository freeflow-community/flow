// ⌘K switcher (premium pass, .impeccable.md): keyboard-first channel/DM/member
// jumping. Opened from Main's global key listener; everything here is
// ephemeral UI state — selection goes through the shared SelectionContext.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChannelDTO } from '@flow/shared';
import { api } from '../lib/api';
import { useAuth, useSelection } from '../state';
import { useChannels, useMembers, useNameMap } from '../hooks';
import { dmTitle } from './Sidebar';
import { AgentMarkIcon, HashIcon, LockIcon, UsersIcon } from './icons';
import { Avatar } from './Avatar';

interface Item {
  key: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void | Promise<void>;
}

/** startsWith beats includes beats none; label-length breaks ties so short
 * exact-ish names surface first. */
function score(label: string, q: string): number {
  const l = label.toLowerCase();
  if (!q) return 1;
  if (l.startsWith(q)) return 3;
  const wordStart = l.split(/[\s-_]+/).some((w) => w.startsWith(q));
  if (wordStart) return 2;
  if (l.includes(q)) return 1;
  return 0;
}

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const sel = useSelection();
  const qc = useQueryClient();
  const channels = useChannels(sel.workspaceId);
  const members = useMembers(sel.workspaceId);
  const names = useNameMap(sel.workspaceId);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const openDm = async (userId: string) => {
    if (!sel.workspaceId) return;
    const ch = await api<ChannelDTO>('POST', `/v1/workspaces/${sel.workspaceId}/dms`, { userIds: [userId] });
    await qc.invalidateQueries({ queryKey: ['channels', sel.workspaceId] });
    sel.selectChannel(ch.id);
  };

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const chans: (Item & { s: number })[] = (channels.data ?? [])
      .filter((c) => c.isMember)
      .map((c) => {
        const label = c.kind === 'standard' ? (c.name ?? '') : dmTitle(c, names, auth.user.id);
        return {
          key: `c-${c.id}`,
          label,
          hint: c.kind === 'standard' ? undefined : 'direct message',
          icon:
            c.kind === 'standard' ? (
              c.isPrivate ? <LockIcon size={14} /> : <HashIcon size={14} />
            ) : (
              <UsersIcon size={14} />
            ),
          run: () => sel.selectChannel(c.id),
          s: score(label, q),
        };
      });
    const dmMemberIds = new Set(
      (channels.data ?? [])
        .filter((c) => c.kind === 'dm')
        .flatMap((c) => c.memberIds ?? []),
    );
    const people: (Item & { s: number })[] = (members.data ?? [])
      .filter((m) => m.userId !== auth.user.id && !dmMemberIds.has(m.userId))
      .map((m) => ({
        key: `m-${m.userId}`,
        label: m.displayName,
        hint: m.isAgent ? 'agent — start a DM' : 'start a DM',
        icon: m.isAgent ? (
          <span className="text-accent"><AgentMarkIcon size={12} /></span>
        ) : (
          <Avatar userId={m.userId} name={m.displayName} avatarUrl={m.avatarUrl} size={18} radius={6} />
        ),
        run: () => void openDm(m.userId),
        s: score(m.displayName, q),
      }));
    return [...chans, ...people]
      .filter((i) => i.s > 0)
      .sort((a, b) => b.s - a.s || a.label.length - b.label.length)
      .slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels.data, members.data, names, query, auth.user.id]);

  const selected = Math.min(index, Math.max(0, items.length - 1));

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (i + 1) % Math.max(1, items.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (i - 1 + Math.max(1, items.length)) % Math.max(1, items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[selected];
      if (item) {
        onClose();
        void item.run();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      data-testid="command-palette"
      className="mc-fade-in fixed inset-0 z-50 flex justify-center bg-black/20 pt-[18vh]"
      onMouseDown={onClose}
    >
      <div
        className="mc-pop-in flex h-fit w-[min(560px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-white shadow-float"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          data-testid="command-palette-input"
          className="w-full border-b border-hairline px-4 py-3.5 text-[15px] text-ink outline-none placeholder:text-faint"
          placeholder="Jump to a channel, DM, or teammate…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
          onKeyDown={onKeyDown}
        />
        {items.length > 0 && (
          <div ref={listRef} className="mc-scroll max-h-80 overflow-y-auto p-1.5">
            {items.map((item, i) => (
              <button
                key={item.key}
                data-index={i}
                data-testid={`palette-item-${item.label}`}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${
                  i === selected ? 'bg-accent-wash text-ink' : 'text-ink-soft hover:bg-daypill/60'
                }`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => { onClose(); void item.run(); }}
              >
                <span className="flex w-5 shrink-0 items-center justify-center text-muted">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                {item.hint && <span className="shrink-0 text-xs text-faint">{item.hint}</span>}
              </button>
            ))}
          </div>
        )}
        {query.trim() && items.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-faint">Nothing matches — try fewer letters.</p>
        )}
      </div>
    </div>
  );
}
