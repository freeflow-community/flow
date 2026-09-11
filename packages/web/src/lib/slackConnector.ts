import { canonicalizeOrigin } from './serverOrigin';

export interface SlackIdentity { environment: 'slack'; enterpriseId: string | null; teamId: string; userId: string }
export interface SlackConnection {
  identity: SlackIdentity; grantId: string; teamName: string; userName: string;
  scopes: string[]; capabilities: Record<string, boolean>; grantStatus: string;
}
export interface SlackHandoff extends SlackConnection { credential: string; status: string }
export const slackIdentityKey = (i: SlackIdentity) => JSON.stringify([i.environment, i.enterpriseId ?? null, i.teamId, i.userId]);
export const slackStatusMessage = (status: string) => ({
  canceled: 'Slack sign-in was canceled.', consent_denied: 'Slack consent was denied.',
  approval_required: 'Your Slack administrator must approve this app.', approval_denied: 'Slack workspace app approval was denied.',
  wrong_team: 'A different Slack team was authorized. Retry with the intended team.',
  missing_scopes: 'Connected with limited permissions. Reauthorize to grant the missing permissions.',
  revoked: 'Slack access was revoked. Reauthorize this connection.', app_removed: 'The Slack app was removed from this team.',
  account_deactivated: 'This Slack account is deactivated.', reauthorization_required: 'Slack authorization expired. Reauthorize this connection.',
  rotation_required: 'Enable token rotation on the Slack app before connecting.',
  enterprise_grant_unsupported: 'Connect an individual Slack workspace; organization-wide grants are not supported yet.',
}[status] ?? `Slack connector: ${status.replaceAll('_', ' ')}.`);

export async function slackRequest<T>(origin: string, path: string, method = 'GET', body?: unknown, credential?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${origin}${path}`, { method, credentials: 'omit', redirect: 'error', signal,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(credential ? { authorization: `Bearer ${credential}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(slackStatusMessage(typeof result.error === 'string' ? result.error : 'request_failed'));
  return result;
}
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

export async function connectSlack(address: string, popup: Window, signal: AbortSignal, expectedTeamId?: string): Promise<{ origin: string; connection: SlackHandoff }> {
  let origin: string;
  try {
    origin = canonicalizeOrigin(address).origin;
    if (!origin.startsWith('https://')) throw new Error('Use an HTTPS Slack connector.');
    if (signal.aborted) throw new Error(slackStatusMessage('canceled'));
    const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const start = await slackRequest<{ authorizationUrl: string; operationId: string }>(origin, '/v1/oauth/start', 'POST', { challenge, clientOrigin: location.origin, expectedTeamId }, undefined, signal);
    const authorization = new URL(start.authorizationUrl);
    if (authorization.origin !== 'https://slack.com' || authorization.pathname !== '/oauth/v2/authorize') throw new Error('Invalid Slack authorization destination.');
    if (signal.aborted) throw new Error(slackStatusMessage('canceled'));
    const handoff = await new Promise<string>((resolve, reject) => {
      const cleanup = () => { window.removeEventListener('message', receive); signal.removeEventListener('abort', abort); clearInterval(timer); };
      const abort = () => { cleanup(); reject(new Error(slackStatusMessage('canceled'))); };
      const receive = (event: MessageEvent) => {
        if (event.origin !== origin || event.source !== popup || event.data?.type !== 'flow-slack-handoff' || event.data.operationId !== start.operationId || typeof event.data.handoff !== 'string') return;
        cleanup(); resolve(event.data.handoff);
      };
      const deadline = Date.now() + 600_000;
      const timer = setInterval(() => { if (popup.closed || Date.now() > deadline) abort(); }, 500);
      window.addEventListener('message', receive);
      signal.addEventListener('abort', abort, { once: true });
      popup.location.href = authorization.href;
    });
    const connection = await slackRequest<SlackHandoff>(origin, '/v1/oauth/exchange', 'POST', { handoff, verifier, operationId: start.operationId, clientOrigin: location.origin }, undefined, signal);
    if (!connection.credential || !['connected', 'missing_scopes'].includes(connection.status)) throw new Error(slackStatusMessage(connection.status));
    if (connection.identity?.environment !== 'slack' || !/^[A-Z][A-Z0-9]+$/.test(connection.identity.teamId) || !/^[A-Z][A-Z0-9]+$/.test(connection.identity.userId)) throw new Error('Invalid Slack identity.');
    return { origin, connection };
  } finally { popup.close(); }
}
