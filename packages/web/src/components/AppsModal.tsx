// Phase 4 §1: app management (admin-only, web client per ruling 1).
// Register Slack-compat apps, show the one-time bot token, configure the
// outgoing Events API subscription, and disable/enable apps.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { APP_EVENT_TYPES } from '@mychat/shared';
import type { AppDTO } from '@mychat/shared';
import { api } from '../lib/api';
import { useApps } from '../hooks';
import { Modal } from './modals';

export function AppsModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const apps = useApps(workspaceId);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ app: AppDTO; botToken: string }>(
        'POST',
        `/v1/workspaces/${workspaceId}/apps`,
        { name: name.trim() },
      );
      setToken(res.botToken);
      setCopied(false);
      setName('');
      await qc.invalidateQueries({ queryKey: ['apps', workspaceId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal onClose={onClose} testid="apps-modal" wide>
      <h3 className="mb-1 font-bold">Manage Apps</h3>
      <p className="mb-3 text-sm text-muted">
        Apps get a bot user and token, and can subscribe to workspace events.
      </p>

      <div className="mb-2 flex gap-2">
        <input
          data-testid="app-create-name"
          className="w-full rounded border border-hairline2 px-3 py-2 text-sm"
          placeholder="App name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <button
          data-testid="app-create-submit"
          className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!name.trim() || busy}
          onClick={() => void create()}
        >
          Create
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      {token && (
        <div className="mb-3 rounded-lg border border-hairline2 bg-daypill/40 p-3">
          <p className="mb-1 text-sm font-semibold">Bot token</p>
          <p className="mb-2 text-xs text-red-600">
            Copy it now — this token won&rsquo;t be shown again.
          </p>
          <code data-testid="app-token" className="mb-2 block rounded bg-daypill p-2 text-xs break-all select-all">
            {token}
          </code>
          <div className="flex justify-end gap-2">
            <button
              data-testid="app-token-copy"
              className="rounded bg-accent px-3 py-1 text-xs font-semibold text-white"
              onClick={() => void copy()}
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
            <button className="px-3 py-1 text-xs text-ink-soft" onClick={() => setToken(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="mc-scroll mb-3 max-h-[340px] overflow-y-auto">
        {apps.isLoading && <p className="py-4 text-center text-sm text-faint">Loading…</p>}
        {apps.isError && (
          <p className="py-2 text-sm text-red-600">
            {apps.error instanceof Error ? apps.error.message : 'failed to load apps'}
          </p>
        )}
        {apps.data?.length === 0 && <p className="py-4 text-center text-sm text-faint">No apps yet.</p>}
        {(apps.data ?? []).map((a) => (
          <AppRow
            key={a.id}
            app={a}
            workspaceId={workspaceId}
            expanded={expandedId === a.id}
            onToggle={() => setExpandedId((v) => (v === a.id ? null : a.id))}
          />
        ))}
      </div>

      <div className="flex justify-end">
        <button className="px-3 py-1.5 text-sm text-ink-soft" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

function AppRow({
  app,
  workspaceId,
  expanded,
  onToggle,
}: {
  app: AppDTO;
  workspaceId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const qc = useQueryClient();
  const [eventUrl, setEventUrl] = useState(app.eventUrl ?? '');
  const [types, setTypes] = useState<Set<string>>(() => new Set(app.eventTypes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = app.disabledAt !== null;

  const act = (fn: () => Promise<unknown>) => {
    void (async () => {
      setError(null);
      setBusy(true);
      try {
        await fn();
        await qc.invalidateQueries({ queryKey: ['apps', workspaceId] });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed');
      } finally {
        setBusy(false);
      }
    })();
  };

  const save = () =>
    act(() =>
      api<AppDTO>('PATCH', `/v1/apps/${app.id}`, {
        eventUrl: eventUrl.trim() ? eventUrl.trim() : null,
        eventTypes: Array.from(types),
      }),
    );

  return (
    <div data-testid={`app-row-${app.name}`} className="mb-2 rounded-lg border border-hairline2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="truncate">{app.name}</span>
            {disabled && (
              <span className="rounded bg-red-50 px-1.5 py-px text-[11px] font-semibold text-red-600">
                disabled
              </span>
            )}
          </p>
          <p className="text-xs text-muted">
            bot {app.botUserId.slice(0, 8)} · created {new Date(app.createdAt).toLocaleDateString()}
          </p>
          {app.eventUrl && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              <span className="truncate">{app.eventUrl}</span>
              <span
                data-testid={`app-verified-${app.name}`}
                data-verified={app.eventUrlVerified}
                className={`shrink-0 rounded px-1.5 py-px text-[11px] font-semibold ${
                  app.eventUrlVerified ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                }`}
              >
                {app.eventUrlVerified ? 'verified' : 'unverified'}
              </span>
            </p>
          )}
        </div>
        <button
          data-testid={`app-config-${app.name}`}
          className="shrink-0 text-xs text-accent-soft hover:underline"
          onClick={onToggle}
        >
          {expanded ? 'Hide' : 'Configure'}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-hairline2 pt-3">
          <label className="mb-1 block text-xs font-semibold text-faint uppercase">Event URL</label>
          <input
            data-testid={`app-eventurl-${app.name}`}
            className="mb-2 w-full rounded border border-hairline2 px-3 py-2 text-sm"
            placeholder="https://example.com/mychat/events"
            value={eventUrl}
            onChange={(e) => setEventUrl(e.target.value)}
          />
          <p className="mb-1 text-xs font-semibold text-faint uppercase">Event subscriptions</p>
          <div className="mb-2 grid grid-cols-2 gap-x-3">
            {APP_EVENT_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 py-0.5 text-sm">
                <input
                  type="checkbox"
                  data-testid={`app-eventtype-${app.name}-${t}`}
                  checked={types.has(t)}
                  onChange={(e) => {
                    const next = new Set(types);
                    if (e.target.checked) next.add(t);
                    else next.delete(t);
                    setTypes(next);
                  }}
                />
                {t}
              </label>
            ))}
          </div>
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          <div className="flex items-center justify-between">
            {disabled ? (
              <button
                data-testid={`app-enable-${app.name}`}
                className="rounded border border-hairline px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={busy}
                onClick={() => act(() => api<AppDTO>('POST', `/v1/apps/${app.id}/enable`))}
              >
                Enable
              </button>
            ) : (
              <button
                data-testid={`app-disable-${app.name}`}
                className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                disabled={busy}
                onClick={() => act(() => api<AppDTO>('POST', `/v1/apps/${app.id}/disable`))}
              >
                Disable
              </button>
            )}
            <button
              data-testid={`app-save-${app.name}`}
              className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              disabled={busy}
              onClick={save}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
