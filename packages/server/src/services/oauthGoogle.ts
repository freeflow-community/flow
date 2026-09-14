// Phase 16: Google Sign-In (ID-token flow) + domain self-registration.
//
// The client obtains a Google **ID token** (a signed JWT) from Google Identity
// Services and posts it here; we never see the user's Google password and we
// never hand-roll JWT verification — google-auth-library checks the signature
// against Google's rotating JWKS (which it caches), the issuer, the audience
// and the expiry. See phase16.md §2/§8 for why ID-token beats the auth-code
// flow here: no client secret, no redirect URI, no server-side exchange.
//
// The provider-agnostic account matching / self-registration lives in
// oauthAccounts.ts (shared with Apple); this file is the Google-specific rim:
// token verification and avatar seeding.
import { OAuth2Client } from 'google-auth-library';
import { eq } from 'drizzle-orm';
import type { OAuthSignInResponse } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { config } from '../config.js';
import { issueSession, toUserDTO } from './auth.js';
import { setAvatar } from './users.js';
import { resolveOAuthUser, selfRegisterByDomain } from './oauthAccounts.js';

const { users } = schema;

/** The subset of the verified ID-token payload we act on (phase16 §2). */
export interface GoogleClaims {
  /** Google's stable user id — the durable join key (survives an email change). */
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string | undefined;
  picture?: string | undefined;
  /** Hosted domain — present only for Google Workspace accounts. */
  hd?: string | undefined;
}

let client: OAuth2Client | null = null;

/** Verify a Google ID token → its claims. Throws 503 when Google sign-in is
 * not configured and 401 when the token doesn't check out. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleClaims> {
  const audience = config.googleClientId;
  if (!audience) throw new ApiError(503, 'google_disabled', 'Google sign-in is not configured on this server');
  client ??= new OAuth2Client();
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch (err) {
    // The library's message describes the malformed JWT — useful in the log,
    // noise (and a fingerprinting hint) in the response.
    console.warn(`google id token rejected: ${(err as Error).message}`);
    throw new ApiError(401, 'google_token_invalid', 'that Google sign-in could not be verified');
  }
  if (!payload?.sub || !payload.email) {
    throw new ApiError(401, 'google_token_invalid', 'Google token carried no account');
  }
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: payload.name,
    picture: payload.picture,
    hd: payload.hd,
  };
}

/** Sign in (or register — with Google they're the same act) and auto-enroll. */
export async function signInWithGoogle(idToken: string, clientInfo?: string): Promise<OAuthSignInResponse> {
  return signInWithGoogleClaims(await verifyGoogleIdToken(idToken), clientInfo);
}

/**
 * Everything after verification (phase16 §4). Split out so the whole flow is
 * testable without minting real Google tokens.
 */
export async function signInWithGoogleClaims(
  claims: GoogleClaims,
  clientInfo?: string,
): Promise<OAuthSignInResponse> {
  // An unverified Google email proves nothing: it can neither link to an
  // existing Flow account nor satisfy the domain self-register rule.
  if (!claims.emailVerified) {
    throw new ApiError(403, 'email_unverified', 'your Google email address is not verified');
  }
  const email = claims.email.toLowerCase();
  const hd = claims.hd?.toLowerCase() ?? null;

  const userId = await resolveOAuthUser({
    provider: 'google',
    sub: claims.sub,
    email,
    hostedDomain: hd,
    name: claims.name,
  });
  await backfillProfile(userId, claims);
  const autoJoined = await selfRegisterByDomain(userId, email);

  const row = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!row) throw new ApiError(500, 'internal', 'user vanished during sign-in');
  const token = await issueSession(userId, clientInfo);
  return { token, user: toUserDTO(row, row.id), autoJoined };
}

/** Google serves profile pictures from this host only — the URL rides inside a
 * Google-signed token, but we still refuse to fetch anything else. */
const GOOGLE_PICTURE_HOST_RE = /(^|\.)googleusercontent\.com$/i;

/**
 * Seed the avatar from Google's `picture` — but only when the user has none, so
 * a chosen avatar is never overwritten (phase16 §3). The bytes go through the
 * normal avatar pipeline (square crop → webp → blob store) rather than storing
 * Google's URL: clients fetch `avatarUrl` with a bearer header, which only
 * works for our own paths. Entirely best-effort.
 */
async function backfillProfile(userId: string, claims: GoogleClaims): Promise<void> {
  if (!claims.picture) return;
  const row = (await db.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!row || row.avatarUrl) return;
  try {
    const url = new URL(claims.picture);
    if (url.protocol !== 'https:' || !GOOGLE_PICTURE_HOST_RE.test(url.hostname)) return;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return;
    const mimeType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length === 0 || data.length > config.maxServerUploadBytes) return;
    await setAvatar(userId, data, mimeType);
  } catch (err) {
    console.warn(`google avatar seed failed for ${userId}: ${(err as Error).message}`);
  }
}
