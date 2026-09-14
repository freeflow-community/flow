// APNs provider authentication tokens (#250, PUSH_APNS.md § "The sender seam").
//
// Apple authenticates a provider with a bare ES256 JWT signed by the team's
// `.p8` Auth Key: `authorization: bearer <jwt>`, no refresh flow, no exchange.
// The only rule with teeth is the refresh window — Apple rejects a token older
// than **60 minutes** and rate-limits a provider that mints a fresh one per
// request, so the supported cadence is "re-sign somewhere between 20 and 60
// minutes". We cache one token for 55 minutes in module state and re-sign on
// demand, which sits inside that window with five minutes of clock slack.
//
// One token serves every topic and both environments, so the cache is a single
// slot rather than a map: the JWT names the *team*, and the app is named by the
// `apns-topic` header on each request.
import { SignJWT, importPKCS8 } from 'jose';
import { config } from '../config.js';

/** Re-sign after this long. Apple's window is 20–60 min; 55 leaves clock slack. */
const TTL_MS = 55 * 60 * 1000;

interface CachedToken {
  jwt: string;
  /** Wall-clock ms after which this token is re-signed. */
  expiresAt: number;
  /** Which credentials minted it — a config change invalidates the cache. */
  fingerprint: string;
}

let cached: CachedToken | null = null;

/** The three vars that must be set for the `apns` driver to authenticate. */
export interface ApnsCredentials {
  /** The `.p8` Auth Key, PEM text (already base64-decoded if it needed it). */
  keyPem: string;
  /** 10-char key id — rides in the JWT header as `kid`. */
  keyId: string;
  /** Apple Developer team id — the JWT's `iss`. */
  teamId: string;
}

/**
 * Read the credentials out of config, or say precisely what is missing.
 *
 * `FLOW_APNS_KEY` is documented as base64 of the `.p8`, but a PEM pasted in
 * raw is the obvious operator slip and costs one branch to accept — the
 * failure it would otherwise produce is an opaque OpenSSL error at first push,
 * hours after the deploy that caused it.
 */
export function apnsCredentials(): ApnsCredentials {
  const missing = [
    config.apnsKey ? null : 'FLOW_APNS_KEY',
    config.apnsKeyId ? null : 'FLOW_APNS_KEY_ID',
    config.apnsTeamId ? null : 'FLOW_APNS_TEAM_ID',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`FLOW_PUSH_DRIVER=apns needs ${missing.join(', ')} — see docs/ops/DEPLOYMENT.md`);
  }
  const raw = config.apnsKey!;
  const keyPem = raw.includes('BEGIN PRIVATE KEY') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  if (!keyPem.includes('BEGIN PRIVATE KEY')) {
    throw new Error('FLOW_APNS_KEY is neither a PKCS#8 PEM nor base64 of one');
  }
  return { keyPem, keyId: config.apnsKeyId!, teamId: config.apnsTeamId! };
}

/**
 * The current provider token, signing a new one only when the cached one has
 * aged out (or the credentials changed under it).
 */
export async function apnsProviderToken(now: number = Date.now()): Promise<string> {
  const creds = apnsCredentials();
  const fingerprint = `${creds.teamId}:${creds.keyId}:${creds.keyPem.length}`;
  if (cached && cached.expiresAt > now && cached.fingerprint === fingerprint) return cached.jwt;
  const key = await importPKCS8(creds.keyPem, 'ES256');
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: creds.keyId })
    .setIssuer(creds.teamId)
    .setIssuedAt(Math.floor(now / 1000))
    .sign(key);
  cached = { jwt, expiresAt: now + TTL_MS, fingerprint };
  return jwt;
}

/**
 * Drop the cached token.
 *
 * Called on a 403 `ExpiredProviderToken` — the one 403 that is not an operator
 * alarm. It means our clock and Apple's disagree about the 60-minute window,
 * and the fix is to re-sign, not to page anyone. Also used by tests.
 */
export function resetApnsProviderToken(): void {
  cached = null;
}
