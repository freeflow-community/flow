// The channel browser (#588) — every public channel in the workspace, joined
// or not, in the same "sentinel channel id" shape as the Directory. Replaces
// the sidebar's inline Browse list, which listed every unjoined channel and
// did not scale; reached from the "Browse all" row under Channels.
//
// Archived channels are hidden unless "Include archived" is on. Opening one is
// read-only: ChannelView resolves it through the archived-inclusive list and
// swaps the composer for the archived banner.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChannelDTO } from '@flow/shared';
import { api } from '../lib/api';
import { useSelection } from '../state';
import { useChannelsWithArchived } from '../hooks';
import { MobileMenuButton } from './MobileMenuButton';

/**
 * Public standard channels only — DMs and private channels are not browsable.
 * Case-insensitive substring over name and topic; archived channels drop out
 * unless asked for. Sorted by name, archived or not, so turning the toggle on
 * slots them in place rather than piling them at the end.
 */
export function filterChannels(channels: ChannelDTO[], query: string, includeArchived: boolean): ChannelDTO[] {
  const q = query.trim().toLowerCase();
  return channels
    .filter((c) => c.kind === 'standard' && !c.isPrivate)
    .filter((c) => includeArchived || !c.archivedAt)
    .filter((c) => q === '' || (c.name ?? '').toLowerCase().includes(q) || (c.topic ?? '').toLowerCase().includes(q))
    .slice()
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' }));
}

/** The presentational half, prop-driven so it renders in a test without a
 * query client. */
export function ChannelBrowserList({
  channels,
  loading,
  query,
  onQuery,
  includeArchived,
  onIncludeArchived,
  joiningId,
  onOpen,
  onJoin,
}: {
  channels: ChannelDTO[];
  loading: boolean;
  query: string;
  onQuery: (v: string) => void;
  includeArchived: boolean;
  onIncludeArchived: (v: boolean) => void;
  joiningId: string | null;
  onOpen: (channelId: string) => void;
  onJoin: (channelId: string) => void;
}) {
  const shown = filterChannels(channels, query, includeArchived);
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-base">
      <header className="flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-hairline px-[22px] max-md:px-3">
        <MobileMenuButton />
        <div className="min-w-0 flex-1">
          <h2 data-testid="channel-browser-header" className="truncate text-[15px] font-bold">
            <span className="text-muted"># </span>Browse channels
          </h2>
          <p className="truncate text-xs text-muted">Every public channel in this workspace</p>
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-3 border-b border-hairline3 px-[22px] py-2 max-md:px-3">
        <input
          data-testid="channel-browser-search"
          type="search"
          value={query}
          placeholder="Search channels…"
          aria-label="Search channels"
          className="w-full max-w-sm rounded-lg border border-hairline2 bg-base px-3 py-1.5 text-sm"
          onChange={(e) => onQuery(e.target.value)}
        />
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-ink-soft select-none">
          <input
            data-testid="channel-browser-include-archived"
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => onIncludeArchived(e.target.checked)}
          />
          Include archived
        </label>
        <span className="ml-auto shrink-0 text-xs text-faint" data-testid="channel-browser-count">
          {shown.length} {shown.length === 1 ? 'channel' : 'channels'}
        </span>
      </div>

      <div className="mc-scroll min-h-0 flex-1 overflow-y-auto px-[22px] py-2 max-md:px-3" data-testid="channel-browser-list">
        {loading && channels.length === 0 ? (
          <p className="py-16 text-center text-sm text-faint" data-testid="channel-browser-loading">
            Loading…
          </p>
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-sm text-faint" data-testid="channel-browser-empty">
            {query.trim() === '' ? 'No public channels yet.' : `No channels match “${query.trim()}”.`}
          </p>
        ) : (
          <ul className="divide-y divide-hairline3">
            {shown.map((c) => (
              <ChannelBrowserRow
                key={c.id}
                channel={c}
                joining={joiningId === c.id}
                onOpen={() => onOpen(c.id)}
                onJoin={() => onJoin(c.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ChannelBrowserRow({
  channel: c,
  joining,
  onOpen,
  onJoin,
}: {
  channel: ChannelDTO;
  joining: boolean;
  onOpen: () => void;
  onJoin: () => void;
}) {
  const archived = !!c.archivedAt;
  const count = c.memberCount ?? 0;
  return (
    <li
      data-testid={`channel-browser-row-${c.name}`}
      data-archived={archived}
      className={`group flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-daypill/50 ${archived ? 'opacity-60' : ''}`}
      onClick={onOpen}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-bold">
          <span className="truncate"><span className="text-muted"># </span>{c.name}</span>
          {archived && (
            <span
              data-testid="channel-browser-archived-badge"
              className="shrink-0 rounded-full bg-orange-100 px-1.5 py-px text-[10px] font-semibold tracking-wide text-orange-700 uppercase"
            >
              Archived
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted">
          {count} {count === 1 ? 'member' : 'members'}
          {c.topic && <> · {c.topic}</>}
        </p>
      </div>
      {c.isMember ? (
        <span data-testid="channel-browser-joined" className="shrink-0 text-xs font-semibold text-online">
          ✓ Joined
        </span>
      ) : archived ? null : (
        <button
          type="button"
          data-testid={`channel-browser-join-${c.name}`}
          disabled={joining}
          className="shrink-0 rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          onClick={(e) => {
            e.stopPropagation();
            onJoin();
          }}
        >
          {joining ? 'Joining…' : 'Join'}
        </button>
      )}
    </li>
  );
}

export default function ChannelBrowserView() {
  const sel = useSelection();
  const qc = useQueryClient();
  const channels = useChannelsWithArchived(sel.workspaceId);
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const join = async (channelId: string) => {
    setJoiningId(channelId);
    setError(null);
    try {
      await api('POST', `/v1/channels/${channelId}/join`);
      await qc.invalidateQueries({ queryKey: ['channels', sel.workspaceId] });
      sel.selectChannel(channelId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join the channel');
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <>
      <ChannelBrowserList
        channels={channels.data ?? []}
        loading={channels.isLoading}
        query={query}
        onQuery={setQuery}
        includeArchived={includeArchived}
        onIncludeArchived={setIncludeArchived}
        joiningId={joiningId}
        // A channel you haven't joined opens as a preview (public history is
        // readable); archived ones open read-only.
        onOpen={(id) => sel.selectChannel(id)}
        onJoin={(id) => void join(id)}
      />
      {error && (
        <div
          data-testid="channel-browser-error"
          role="alert"
          className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-2xl"
        >
          {error}
        </div>
      )}
    </>
  );
}
