import { useEffect, useRef, useState } from 'react';
import { connectionManager } from '../lib/connectionRuntime';
import { connectSlack, slackRequest, slackStatusMessage, type SlackConnection, type SlackHandoff } from '../lib/slackConnector';

export default function SlackConnections({ onChange, onOpen }: { onChange(): void; onOpen?(connectionId: string, workspaceId: string): void }) {
  const manager = connectionManager();
  const configuredOrigin = import.meta.env.VITE_SLACK_CONNECTOR_ORIGIN?.trim() ?? '';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<{ origin: string; connection: SlackHandoff } | null>(null);
  const [states, setStates] = useState<Record<string, string>>({});
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const poll = async () => {
      for (const connection of manager.connections.filter(c => c.provider === 'slack')) {
        const runtime = manager.runtime(connection.connectionId)!;
        if (!runtime.getToken()) continue;
        try {
          const result = await slackRequest<{ events: { status: string }[] }>(runtime.origin, '/v1/events', 'GET', undefined, runtime.getToken()!, controller.signal);
          const status = result.events.at(-1)?.status;
          if (status && !controller.signal.aborted) setStates(s => ({ ...s, [connection.connectionId]: slackStatusMessage(status) }));
        } catch (error) {
          if (!controller.signal.aborted) setStates(s => ({ ...s, [connection.connectionId]: (error as Error).message }));
        }
      }
    };
    for (const connection of manager.connections.filter(c => c.provider === 'slack')) {
      const runtime = manager.runtime(connection.connectionId)!;
      if (runtime.getToken()) void slackRequest<SlackConnection>(runtime.origin, '/v1/connection', 'GET', undefined, runtime.getToken()!, controller.signal).catch(error => {
        if (!controller.signal.aborted) setStates(s => ({ ...s, [connection.connectionId]: (error as Error).message }));
      });
    }
    void poll();
    const timer = setInterval(() => { void poll(); }, 15_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [manager, manager.connections]);

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
  const disconnect = async (id: string) => {
    const runtime = manager.runtime(id)!;
    // Keep credentials available for retry if connector revocation is offline.
    await slackRequest(runtime.origin, '/v1/session', 'DELETE', undefined, runtime.getToken() ?? undefined);
    manager.signOut(id, true); onChange();
  };
  const cancelPending = async () => {
    if (pending) await slackRequest(pending.origin, '/v1/session', 'DELETE', undefined, pending.connection.credential);
    setPending(null);
  };
  return <section className="my-5 border-y border-hairline2 py-4" aria-label="Slack connections">
    <h3 className="font-semibold">Slack workspaces</h3>
    {manager.connections.filter(c => c.provider === 'slack').map(connection => <div key={connection.connectionId} className="my-3 rounded border p-3">
      <p className="font-medium">Slack · {connection.label}</p>
      <p className="break-all text-xs text-faint">Connector: {connection.origin}</p>
      {states[connection.connectionId] && <p className="mt-1 text-sm" role="status">{states[connection.connectionId]}</p>}
      <div className="mt-2 flex gap-3 text-sm">
        {onOpen && <button disabled={busy} data-testid={`open-slack-${connection.connectionId}`} onClick={() => onOpen(connection.connectionId, JSON.parse(connection.providerIdentity)[2])}>Open workspace</button>}
        <button disabled={busy} onClick={() => void perform(async () => {
          const runtime = manager.runtime(connection.connectionId)!;
          try {
            const result = await slackRequest<SlackConnection>(runtime.origin, '/v1/connection', 'GET', undefined, runtime.getToken() ?? undefined);
            setStates(s => ({ ...s, [connection.connectionId]: `${result.teamName} · ${result.userName} · ${result.scopes.join(', ') || 'No optional permissions'}` }));
          } catch (error) { setStates(s => ({ ...s, [connection.connectionId]: (error as Error).message })); }
        })}>Check authorization</button>
        <button disabled={busy || !!pending} onClick={() => authorize(connection.origin, JSON.parse(connection.providerIdentity)[2])}>Reauthorize</button>
        <button disabled={busy} onClick={() => void perform(() => disconnect(connection.connectionId))}>Disconnect this client</button>
      </div>
    </div>)}
    <p className="my-2 text-sm text-faint">Sign in with your Slack account. Flow’s connector stores your authorization and handles Slack content on your behalf.</p>
    {configuredOrigin ? <p className="mb-2 break-all text-xs text-faint">Connector: {configuredOrigin}</p> : <p className="mb-2 text-sm">Slack connection is not configured on this Flow deployment. Ask your Flow administrator to enable it.</p>}

    <button disabled={busy || !configuredOrigin || !!pending} onClick={() => authorize(configuredOrigin)}>Connect Slack</button>
    {busy && <button className="ml-3" onClick={() => operation.current?.abort()}>Cancel</button>}
    {pending && <div className="mt-3 rounded border p-3">
      <p>Slack verified <strong>{pending.connection.teamName}</strong> ({pending.connection.identity.teamId}) as <strong>{pending.connection.userName}</strong> ({pending.connection.identity.userId}).</p>
      {pending.connection.status === 'missing_scopes' && <p className="mt-2 text-sm">{slackStatusMessage('missing_scopes')}</p>}
      <p className="my-2 text-sm">Granted: {pending.connection.scopes.join(', ') || 'identity only'}.</p>
      <button disabled={busy} onClick={() => void perform(async () => {
        const old = manager.connections.find(c => c.provider === 'slack' && c.providerIdentity === JSON.stringify(['slack', pending.connection.identity.enterpriseId, pending.connection.identity.teamId, pending.connection.identity.userId]));
        if (old && old.origin !== pending.origin) throw new Error('Disconnect the existing team before changing its connector.');
        if (old) {
          const previous = manager.runtime(old.connectionId)!;
          if (previous.getToken()) await slackRequest(previous.origin, '/v1/session', 'DELETE', undefined, previous.getToken()!);
        }
        const runtime = manager.addSlack(pending.origin, pending.connection);
        manager.noteTokenReplaced(runtime.connectionId, runtime.setToken(pending.connection.credential));
        manager.bindIdentity(runtime.connectionId, pending.connection.identity.userId);
        setPending(null); setStates(s => ({ ...s, [runtime.connectionId]: '' })); onChange();
      })}>Add verified workspace</button>
      <button className="ml-3" disabled={busy} onClick={() => void perform(cancelPending)}>Discard</button>
    </div>}
    {message && <p role="alert" className="mt-2 text-sm text-red-700">{message}</p>}
  </section>;
}
