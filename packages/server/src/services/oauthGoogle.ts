// Phase 16: Google Sign-In (ID-token flow) + domain self-registration.
//
// The client obtains a Google **ID token** (a signed JWT) from Google Identity
// Services and posts it here; we never see the user's Google password and we
// never hand-roll JWT verification — google-auth-library checks the signature
// against Google's rotating JWKS (which it caches), the issuer, the audience
// and the expiry. See phase16.md §2/§8 for why ID-token beats the auth-code
// flow here: no client secret, no redirect URI, no server-side exchange.
import { OAuth2Client } from 'google-auth-library';
import { and, eq, sql } from 'drizzle-orm';
import { emailDomain, type GoogleAuthResponse, type OAuthIdentityDTO, type WorkspaceDTO } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { newToken } from '../lib/tokens.js';
import { ApiError, conflict } from '../lib/errors.js';
import { config } from '../config.js';
import { issueSession, toUserDTO } from './auth.js';
import { setAvatar } from './users.js';
import { announceJoin, enrollInWorkspace, toWorkspaceDTO } from './workspaces.js';

const { users, workspaces, workspaceMembers, oauthIdentities } = schema;

const PROVIDER = 'google';

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
export async function signInWithGoogle(idToken: string, clientInfo?: string): Promise<GoogleAuthResponse> {
  return signInWithGoogleClaims(await verifyGoogleIdToken(idToken), clientInfo);
}

/**
 * Everything after verification (phase16 §4). Split out so the whole flow is
 * testable without minting real Google tokens.
 */
export async function signInWithGoogleClaims(
  claims: GoogleClaims,
  clientInfo?: string,
): Promise<GoogleAuthResponse> {
  // An unverified Google email proves nothing: it can neither link to an
  // existing Flow account nor satisfy the domain self-register rule.
  if (!claims.emailVerified) {
    throw new ApiError(403, 'email_unverified', 'your Google email address is not verified');
  }
  const email = claims.email.toLowerCase();
  const hd = claims.hd?.toLowerCase() ?? null;

  const userId = await resolveUser(claims, email, hd);
  const autoJoined = await selfRegisterByDomain(userId, email);

  const row = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!row) throw new ApiError(500, 'internal', 'user vanished during sign-in');
  const token = await issueSession(userId, clientInfo);
  return { token, user: toUserDTO(row), autoJoined };
}

/**
 * Match order (phase16 §3): `(provider, sub)` first — a returning user, robust
 * to email changes — then the verified email against an existing `users` row (a
 * password user adding Google, or someone invited by email signing in with
 * Google for the first time), else create a Google-first account.
 */
async function resolveUser(claims: GoogleClaims, email: string, hd: string | null): Promise<string> {
  const identity = (
    await db
      .select()
      .from(oauthIdentities)
      .where(and(eq(oauthIdentities.provider, PROVIDER), eq(oauthIdentities.providerSubject, claims.sub)))
      .limit(1)
  )[0];
  if (identity) {
    // Refresh the recorded email/hd — Google is the source of truth for both.
    await db
      .update(oauthIdentities)
      .set({ email, hostedDomain: hd })
      .where(and(eq(oauthIdentities.provider, PROVIDER), eq(oauthIdentities.providerSubject, claims.sub)));
    await backfillProfile(identity.userId, claims);
    return identity.userId;
  }

  const existing = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (existing) {
    // Never merge a human Google login into a service account (phase16 §4).
    if (existing.isBot || existing.isAgent) {
      throw conflict('email_reserved', 'that email belongs to a bot or agent account');
    }
    if (existing.deletedAt) {
      throw conflict('email_reserved', 'that account has been removed');
    }
    await db
      .insert(oauthIdentities)
      .values({ provider: PROVIDER, providerSubject: claims.sub, userId: existing.id, email, hostedDomain: hd });
    // Linking proves address ownership, so a legacy unverified account becomes
    // verified here (same reasoning as the sign-in-link redeem).
    if (!existing.emailVerifiedAt) {
      await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, existing.id));
    }
    await backfillProfile(existing.id, claims);
    return existing.id;
  }

  // Google-first account: a real verified email, no usable password. The
  // sentinel hash mirrors the `!agent:` / `!bot:` trick so `password_hash`
  // stays NOT NULL while argon2.verify can never succeed.
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id,
      email,
      passwordHash: `!google:${newToken()}`,
      displayName: claims.name?.trim() || email.split('@')[0]!,
      emailVerifiedAt: new Date(),
    });
    await tx
      .insert(oauthIdentities)
      .values({ provider: PROVIDER, providerSubject: claims.sub, userId: id, email, hostedDomain: hd });
  });
  await backfillProfile(id, claims);
  return id;
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

/**
 * Domain self-registration (phase16 §4 step 3): every workspace that opened its
 * doors to this email's domain gains the user as a member. Best-effort per
 * workspace — one failure must not sink the sign-in.
 */
async function selfRegisterByDomain(userId: string, email: string): Promise<WorkspaceDTO[]> {
  const domain = emailDomain(email);
  if (!domain) return [];
  const candidates = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.googleSelfRegisterDomain, domain));
  const joined: WorkspaceDTO[] = [];
  for (const ws of candidates) {
    try {
      const already = await db
        .select({ one: sql`1` })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, userId)))
        .limit(1);
      if (already.length > 0) continue;
      const isNew = await db.transaction((tx) => enrollInWorkspace(tx, ws.id, userId));
      if (!isNew) continue;
      await announceJoin(ws.id, userId);
      joined.push(toWorkspaceDTO(ws, 'member'));
    } catch (err) {
      console.error(`google self-register failed for ${userId} → ${ws.slug}: ${(err as Error).message}`);
    }
  }
  return joined;
}

/** GET /v1/me/identities — what the client needs to decide whether to offer
 * the domain toggle (phase16 §5a). */
export async function listIdentities(userId: string): Promise<OAuthIdentityDTO[]> {
  const rows = await db.select().from(oauthIdentities).where(eq(oauthIdentities.userId, userId));
  return rows.map((r) => ({
    provider: r.provider as 'google',
    email: r.email,
    hostedDomain: r.hostedDomain,
    linkedAt: r.createdAt.toISOString(),
  }));
}
