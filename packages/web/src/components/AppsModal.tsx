// Phase 4 §1: app management (admin-only, web client per ruling 1).
// Register Slack-compat apps, show the bot token, configure the outgoing
// Events API subscription, and disable/enable apps. Tokens stay viewable in
// Configure (ui_nits) — apps predating token visibility offer Regenerate.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { APP_EVENT_TYPES } from '@flow/shared';
import type { AppDTO } from '@flow/shared';
import { api } from '../lib/api';
import { useApps } from '../hooks';
import { Modal } from './modals';

export function AppsModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const apps = useApps(workspaceId);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<{ botToken: string; appToken: string; signingSecret: string } | null>(null);
  const [copied, setCopied] = useState<'token' | 'appToken' | 'secret' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ app: AppDTO; botToken: string; appToken: string; signingSecret: string }>(
        'POST',
        `/v1/workspaces/${workspaceId}/apps`,
        { name: name.trim() },
      );
      setCreds({ botToken: res.botToken, appToken: res.appToken, signingSecret: res.signingSecret });
      setCopied(null);
      setName('');
      await qc.invalidateQueries({ queryKey: ['apps', workspaceId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (which: 'token' | 'appToken' | 'secret') => {
    if (!creds) return;
    const value = which === 'token' ? creds.botToken : which === 'appToken' ? creds.appToken : creds.signingSecret;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
    } catch {
      setCopied(null);
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

      {creds && (
        <div className="mb-3 rounded-lg border border-hairline2 bg-daypill/40 p-3">
          <p className="mb-2 text-xs text-red-600">
            Copy these now — they won&rsquo;t be shown again.
          </p>
          <p className="mb-1 text-sm font-semibold">Bot token</p>
          <div className="mb-2 flex items-start gap-2">
            <code data-testid="app-token" className="block grow rounded bg-daypill p-2 text-xs break-all select-all">
              {creds.botToken}
            </code>
            <button
              data-testid="app-token-copy"
              className="shrink-0 rounded bg-accent px-3 py-1 text-xs font-semibold text-white"
              onClick={() => void copy('token')}
            >
              {copied === 'token' ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <p className="mb-1 text-sm font-semibold">App-level token</p>
          <p className="mb-1 text-xs text-muted">For Socket Mode (apps.connections.open) — bots with no public URL.</p>
          <div className="mb-2 flex items-start gap-2">
            <code data-testid="app-app-token" className="block grow rounded bg-daypill p-2 text-xs break-all select-all">
              {creds.appToken}
            </code>
            <button
              data-testid="app-app-token-copy"
              className="shrink-0 rounded bg-accent px-3 py-1 text-xs font-semibold text-white"
              onClick={() => void copy('appToken')}
            >
              {copied === 'appToken' ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <p className="mb-1 text-sm font-semibold">Signing secret</p>
          <p className="mb-1 text-xs text-muted">Verifies the X-Slack-Signature header on event deliveries.</p>
          <div className="mb-2 flex items-start gap-2">
            <code data-testid="app-secret" className="block grow rounded bg-daypill p-2 text-xs break-all select-all">
              {creds.signingSecret}
            </code>
            <button
              data-testid="app-secret-copy"
              className="shrink-0 rounded bg-accent px-3 py-1 text-xs font-semibold text-white"
              onClick={() => void copy('secret')}
            >
              {copied === 'secret' ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <div className="flex justify-end">
            <button className="px-3 py-1 text-xs text-ink-soft" onClick={() => setCreds(null)}>
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

type AppCredentials = { botToken: string | null; appToken: string | null; signingSecret: string };

/** Monospace value + copy button, matching the one-time creation reveal. */
function CredentialRow({
  app,
  label,
  testid,
  value,
}: {
  app: AppDTO;
  label: string;
  testid: string;
  value: string | null;
}) {
  const [copied, setCopied] = useState(false);
  if (value === null) return null; // pre-visibility apps: covered by the regenerate note
  return (
    <div className="mb-1.5">
      <p className="mb-0.5 text-xs font-semibold">{label}</p>
      <div className="flex items-start gap-2">
        <code
          data-testid={`app-cred-${testid}-${app.name}`}
          className="block grow rounded bg-daypill p-2 text-xs break-all select-all"
        >
          {value}
        </code>
        <button
          data-testid={`app-cred-${testid}-copy-${app.name}`}
          className="shrink-0 rounded bg-accent px-3 py-1 text-xs font-semibold text-white"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
    </div>
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
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [creds, setCreds] = useState<AppCredentials | null>(null);
  const [credsError, setCredsError] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const disabled = app.disabledAt !== null;

  // Tokens stay viewable (ui_nits): fetch on first expand, owner/admin only.
  useEffect(() => {
    if (!expanded || creds) return;
    let alive = true;
    api<AppCredentials>('GET', `/v1/apps/${app.id}/credentials`)
      .then((c) => { if (alive) setCreds(c); })
      .catch((err) => { if (alive) setCredsError(err instanceof Error ? err.message : 'failed'); });
    return () => { alive = false; };
  }, [expanded, creds, app.id]);


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

  const rotate = () =>
    act(async () => {
      setCreds(await api<AppCredentials>('POST', `/v1/apps/${app.id}/credentials/rotate`));
      setConfirmRotate(false);
    });

  const remove = () =>
    act(async () => {
      await api('DELETE', `/v1/apps/${app.id}`);
      // Bot user left the workspace: member/mention lists and DM list change.
      await qc.invalidateQueries({ queryKey: ['members', workspaceId] });
      await qc.invalidateQueries({ queryKey: ['channels', workspaceId] });
    });

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
          <p className="mb-1 text-xs font-semibold text-faint uppercase">Credentials</p>
          {credsError && <p className="mb-2 text-sm text-red-600">{credsError}</p>}
          {!creds && !credsError && <p className="mb-2 text-xs text-faint">Loading…</p>}
          {creds && (
            <div className="mb-3">
              <CredentialRow app={app} label="Bot token" testid="bot-token" value={creds.botToken} />
              <CredentialRow app={app} label="App-level token" testid="app-token" value={creds.appToken} />
              <CredentialRow app={app} label="Signing secret" testid="signing-secret" value={creds.signingSecret} />
              {confirmRotate ? (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-xs text-red-600">
                    Regenerate both tokens? The current ones stop working immediately.
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <button
                      className="rounded border border-hairline px-2 py-1 text-xs"
                      disabled={busy}
                      onClick={() => setConfirmRotate(false)}
                    >
                      Cancel
                    </button>
                    <button
                      data-testid={`app-rotate-confirm-${app.name}`}
                      className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      disabled={busy}
                      onClick={rotate}
                    >
                      Regenerate
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-2">
                  {(creds.botToken === null || creds.appToken === null) && (
                    <p className="text-xs text-amber-700">
                      Created before token visibility — regenerate to view.
                    </p>
                  )}
                  <button
                    data-testid={`app-rotate-${app.name}`}
                    className="text-xs text-accent-soft hover:underline"
                    disabled={busy}
                    onClick={() => setConfirmRotate(true)}
                  >
                    Regenerate tokens…
                  </button>
                </div>
              )}
            </div>
          )}

          <label className="mb-1 block text-xs font-semibold text-faint uppercase">Event URL</label>
          <input
            data-testid={`app-eventurl-${app.name}`}
            className="mb-2 w-full rounded border border-hairline2 px-3 py-2 text-sm"
            placeholder="https://example.com/flow/events"
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
          {confirmRemove ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-red-600">
                Remove {app.name}? Its bot leaves the workspace and its DMs are deleted.
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  className="rounded border border-hairline px-3 py-1.5 text-sm"
                  disabled={busy}
                  onClick={() => setConfirmRemove(false)}
                >
                  Cancel
                </button>
                <button
                  data-testid={`app-remove-confirm-${app.name}`}
                  className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={remove}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
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
                  data-testid={`app-remove-${app.name}`}
                  className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => setConfirmRemove(true)}
                >
                  Remove…
                </button>
              </div>
              <button
                data-testid={`app-save-${app.name}`}
                className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                disabled={busy}
                onClick={save}
              >
                Save
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
