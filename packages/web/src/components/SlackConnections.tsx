import { useEffect, useRef, useState } from 'react';
import { connectionManager } from '../lib/connectionRuntime';
import type { ServerConnection } from '../lib/connections';
import { connectSlack, slackRequest, slackStatusMessage, type SlackConnection, type SlackHandoff } from '../lib/slackConnector';

/** Slack consent plus the verify-before-adding step, shared by Connect Slack
 * and a team's Reauthorize. */
function useSlackAuthorize(onChange: () => void) {
  const manager = connectionManager();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<{ origin: string; connection: SlackHandoff } | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await action(); } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const authorize = (origin: string, expectedTeamId?: string) => {
    const popup = window.open('about:blank', 'flow-slack-signin', 'width=560,height=760');
    if (!popup) { setMessage('Allow a popup to authorize Slack.'); return; }
    operation.current?.abort();
    const controller = new AbortController(); operation.current = controller;
    void perform(async () => { setPending(await connectSlack(origin, popup, controller.signal, expectedTeamId)); });
  };
  const cancelPending = async () => {
    if (pending) await slackRequest(pending.origin, '/v1/session', 'DELETE', undefined, pending.connection.credential);
    setPending(null);
  };
  const confirm = (verified: { origin: string; connection: SlackHandoff }) => perform(async () => {
    const old = manager.connections.find(c => c.provider === 'slack' && c.providerIdentity === JSON.stringify(['slack', verified.connection.identity.enterpriseId, verified.connection.identity.teamId, verified.connection.identity.userId]));
    if (old && old.origin !== verified.origin) throw new Error('Disconnect the existing team before changing its connector.');
    if (old) {
      const previous = manager.runtime(old.connectionId)!;
      if (previous.getToken()) await slackRequest(previous.origin, '/v1/session', 'DELETE', undefined, previous.getToken()!);
    }
    const runtime = manager.addSlack(verified.origin, verified.connection);
    manager.noteTokenReplaced(runtime.connectionId, runtime.setToken(verified.connection.credential));
    manager.bindIdentity(runtime.connectionId, verified.connection.identity.userId);
    setPending(null); onChange();
  });
  const view = <>
    {pending && <div className="mt-3 rounded border p-3">
      <p>Slack verified <strong>{pending.connection.teamName}</strong> ({pending.connection.identity.teamId}) as <strong>{pending.connection.userName}</strong> ({pending.connection.identity.userId}).</p>
      {pending.connection.status === 'missing_scopes' && <p className="mt-2 text-sm">{slackStatusMessage('missing_scopes')}</p>}
      <p className="my-2 text-sm">Granted: {pending.connection.scopes.join(', ') || 'identity only'}.</p>
      <button disabled={busy} onClick={() => void confirm(pending)}>Add verified workspace</button>
      <button className="ml-3" disabled={busy} onClick={() => void perform(cancelPending)}>Discard</button>
    </div>}
    {message && <p role="alert" className="mt-2 text-sm text-red-700">{message}</p>}
  </>;
  return { busy, pending, perform, authorize, cancel: () => operation.current?.abort(), view };
}

/** One connected Slack team, listed with the Flow servers in Workspaces &
 * servers: the workspace to open, its status, and its connection actions. */
export function SlackConnectionCard({ connection, onChange, onOpen }: {
  connection: ServerConnection;
  onChange(): void;
  onOpen(connectionId: string, workspaceId: string): void;
}) {
  const manager = connectionManager();
  const auth = useSlackAuthorize(onChange);
  const [state, setState] = useState('');
  const teamId = JSON.parse(connection.providerIdentity)[2] as string;
  const binding = manager.state.bindings.find(b => b.connectionId === connection.connectionId && b.workspaceId === teamId);
  const [teamName, userName] = connection.label.split(' · ');
  useEffect(() => {
    const controller = new AbortController();
    const runtime = manager.runtime(connection.connectionId)!;
    const report = (error: unknown) => { if (!controller.signal.aborted) setState((error as Error).message); };
    const poll = async () => {
      if (!runtime.getToken()) return;
      try {
        const result = await slackRequest<{ events: { status: string }[] }>(runtime.origin, '/v1/events', 'GET', undefined, runtime.getToken()!, controller.signal);
        const status = result.events.at(-1)?.status;
        if (status && !controller.signal.aborted) setState(slackStatusMessage(status));
      } catch (error) { report(error); }
    };
    if (runtime.getToken()) void slackRequest<SlackConnection>(runtime.origin, '/v1/connection', 'GET', undefined, runtime.getToken()!, controller.signal).catch(report);
    void poll();
    const timer = setInterval(() => { void poll(); }, 15_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [manager, connection.connectionId]);
  const disconnect = async () => {
    const runtime = manager.runtime(connection.connectionId)!;
    // Keep credentials available for retry if connector revocation is offline.
    await slackRequest(runtime.origin, '/v1/session', 'DELETE', undefined, runtime.getToken() ?? undefined);
    manager.signOut(connection.connectionId, true); onChange();
  };
  return <section className="mb-4 rounded border border-hairline2 p-3" aria-label={`Slack · ${teamName}`}>
    <h3 className="font-semibold">Slack</h3>
    <p className="text-sm text-faint">{userName ?? connection.label}</p>
    {state && <p className="mt-1 text-sm" role="status">{state}</p>}
    <div className="mt-2">
      <button disabled={auth.busy} data-testid={`open-slack-${connection.connectionId}`} onClick={() => onOpen(connection.connectionId, teamId)}>{binding?.name ?? teamName}</button>
    </div>
    <div className="mt-3 flex flex-wrap gap-3 text-sm">
      <button disabled={auth.busy} onClick={() => void auth.perform(async () => {
        const runtime = manager.runtime(connection.connectionId)!;
        try {
          const result = await slackRequest<SlackConnection>(runtime.origin, '/v1/connection', 'GET', undefined, runtime.getToken() ?? undefined);
          setState(`${result.teamName} · ${result.userName} · ${result.scopes.join(', ') || 'No optional permissions'}`);
        } catch (error) { setState((error as Error).message); }
      })}>Check authorization</button>
      <button disabled={auth.busy || !!auth.pending} onClick={() => auth.authorize(connection.origin, teamId)}>Reauthorize</button>
      <button disabled={auth.busy} onClick={() => void auth.perform(disconnect)}>Disconnect this client</button>
    </div>
    {auth.view}
  </section>;
}

/** Connect a new Slack team through this deployment's connector. */
export default function ConnectSlack({ onChange }: { onChange(): void }) {
  const configuredOrigin = import.meta.env.VITE_SLACK_CONNECTOR_ORIGIN?.trim() ?? '';
  const auth = useSlackAuthorize(onChange);
  return <section className="my-5 border-y border-hairline2 py-4" aria-label="Connect Slack">
    <h3 className="font-semibold">Connect a Slack workspace</h3>
    <p className="my-2 text-sm text-faint">Sign in with your Slack account. Flow’s connector stores your authorization and handles Slack content on your behalf.</p>
    {configuredOrigin ? <p className="mb-2 break-all text-xs text-faint">Connector: {configuredOrigin}</p> : <p className="mb-2 text-sm">Slack connection is not configured on this Flow deployment. Ask your Flow administrator to enable it.</p>}
    <button disabled={auth.busy || !configuredOrigin || !!auth.pending} onClick={() => auth.authorize(configuredOrigin)}>Connect Slack</button>
    {auth.busy && <button className="ml-3" onClick={auth.cancel}>Cancel</button>}
    {auth.view}
  </section>;
}
