import { canonicalizeOrigin } from './serverOrigin';

export interface ServerDiscovery {
  protocolVersion: number;
  displayName: string;
  authMethods: string[];
  registrationAvailable: boolean;
  capabilities: Record<string, boolean>;
}

/** Invite paths are parsed before applying the origin-root deployment policy. */
export function parseServerAddress(input: string) {
  const raw = input.trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  const invite = url.pathname.match(/^\/invite\/([A-Za-z0-9_-]+)$/);
  const join = url.pathname.match(/^\/join\/[^/]+\/([A-Za-z0-9_-]+)$/);
  const path = invite || join ? '/' : url.pathname;
  const normalized = new URL(url.href);
  normalized.pathname = path;
  const { origin } = canonicalizeOrigin(normalized.href);
  return { origin, inviteToken: invite?.[1], joinToken: join?.[1] };
}

export async function discoverServer(input: string, signal?: AbortSignal) {
  const address = parseServerAddress(input);
  let response: Response;
  try {
    response = await fetch(`${address.origin}/v1/client-info`, {
      credentials: 'omit', redirect: 'error', signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Cannot reach this server. Check its address and browser allowed-origin configuration. Redirects are not accepted; enter the destination address explicitly.');
  }
  if (!response.ok) throw new Error(`Discovery failed (HTTP ${response.status}).`);
  const info = await response.json() as ServerDiscovery;
  if (info.protocolVersion !== 1 || !Array.isArray(info.authMethods) ||
      !info.authMethods.every(method => typeof method === 'string') ||
      typeof info.registrationAvailable !== 'boolean' ||
      !info.capabilities || typeof info.capabilities !== 'object') {
    throw new Error('This server does not support this version of Flow connections.');
  }
  return { ...address, info };
}
