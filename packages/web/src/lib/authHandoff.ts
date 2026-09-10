import type { AuthResponse } from '@flow/shared';

export interface HandoffContext {
  connectionId: string;
  operationId: string;
  state: string;
  serverOrigin: string;
  clientOrigin: string | null;
  returnUrl: string;
  requestId: string;
}
const opaque = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function browserSignIn(origin: string, popup: Window, signal: AbortSignal): Promise<AuthResponse> {
  if (signal.aborted) { popup.close(); throw new Error('Sign-in canceled.'); }
  const verifier = opaque();
  const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const context = { connectionId: crypto.randomUUID(), operationId: opaque(), state: opaque(), serverOrigin: origin,
    clientOrigin: location.origin, returnUrl: `${location.origin}/` };
  const post = async (path: string, body: unknown) => {
    const result = await fetch(`${origin}${path}`, { method: 'POST', credentials: 'omit', redirect: 'error', signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = await result.json();
    if (!result.ok) throw new Error(json.error?.message ?? 'Sign-in handoff failed.');
    return json;
  };
  let requestId: string;
  try {
    ({ requestId } = await post('/v1/auth/handoff/start', { ...context, codeChallenge: challenge, codeChallengeMethod: 'S256' }));
    if (signal.aborted) throw new Error('Sign-in canceled.');
  } catch (error) {
    popup.close();
    throw error;
  }
  const bound = { ...context, requestId };
  const target = new URL('/', origin);
  target.searchParams.set('handoff', JSON.stringify(bound));
  return new Promise((resolve, reject) => {
    const cleanup = () => { window.removeEventListener('message', receive); clearInterval(timer); signal.removeEventListener('abort', abort); popup.close(); };
    const abort = () => { cleanup(); reject(new Error('Sign-in canceled.')); };
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== popup || event.data?.type !== 'flow-handoff' ||
          event.data.state !== context.state || event.data.operationId !== context.operationId || typeof event.data.code !== 'string') return;
      cleanup();
      void post('/v1/auth/handoff/exchange', { ...bound, code: event.data.code, codeVerifier: verifier }).then(resolve, reject);
    };
    const deadline = Date.now() + 10 * 60_000;
    const timer = setInterval(() => { if (popup.closed || Date.now() > deadline) abort(); }, 500);
    window.addEventListener('message', receive);
    signal.addEventListener('abort', abort, { once: true });
    popup.location.href = target.href;
  });
}

export function consumeHandoffCallback(): boolean {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') || !params.has('operationId') || !params.has('state')) return false;
  const data = { type: 'flow-handoff', code: params.get('code'), operationId: params.get('operationId'), state: params.get('state') };
  history.replaceState(null, '', location.pathname);
  if (window.opener) window.opener.postMessage(data, location.origin);
  return true;
}

export function pendingHandoff(): HandoffContext | null {
  const params = new URLSearchParams(location.search);
  const value = params.get('handoff');
  if (value) { sessionStorage.setItem('flow.pendingHandoff', value); history.replaceState(null, '', location.pathname); }
  try {
    const context = JSON.parse(sessionStorage.getItem('flow.pendingHandoff') ?? 'null');
    if (context?.serverOrigin !== location.origin || typeof context.returnUrl !== 'string') return null;
    return context;
  } catch { return null; }
}
