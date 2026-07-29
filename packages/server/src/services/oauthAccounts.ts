// The provider-agnostic half of OAuth sign-in (phase16 §3/§4), shared by
// Google and Apple: match or create the Flow account behind a verified
// external identity, and run domain self-registration. Token verification and
// provider-specific profile seeding stay in oauthGoogle.ts / oauthApple.ts.
import { and, eq, sql } from 'drizzle-orm';
import { emailDomain, type OAuthIdentityDTO, type WorkspaceDTO } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { newToken } from '../lib/tokens.js';
import { conflict } from '../lib/errors.js';
import { announceJoin, enrollInWorkspace, toWorkspaceDTO } from './workspaces.js';

const { users, workspaces, workspaceMembers, oauthIdentities } = schema;

export type OAuthProvider = 'google' | 'apple';

/** What the generic resolve step needs from a verified provider payload. */
export interface OAuthProfile {
  provider: OAuthProvider;
  /** The provider's stable user id — the durable join key (survives an email change). */
  sub: string;
  /** Verified email, already lowercased by the caller. */
  email: string;
  /** Google Workspace hosted domain; always null for Apple. */
  hostedDomain: string | null;
  /** Display name for a newly created account, when the provider offers one. */
  name?: string | undefined;
}

/**
 * Match order (phase16 §3): `(provider, sub)` first — a returning user, robust
 * to email changes — then the verified email against an existing `users` row (a
 * password user adding this provider, or someone invited by email signing in
 * with it for the first time), else create a provider-first account.
 */
export async function resolveOAuthUser(profile: OAuthProfile): Promise<string> {
  const { provider, sub, email, hostedDomain } = profile;
  const identity = (
    await db
      .select()
      .from(oauthIdentities)
      .where(and(eq(oauthIdentities.provider, provider), eq(oauthIdentities.providerSubject, sub)))
      .limit(1)
  )[0];
  if (identity) {
    // Refresh the recorded email/hd — the provider is the source of truth for both.
    await db
      .update(oauthIdentities)
      .set({ email, hostedDomain })
      .where(and(eq(oauthIdentities.provider, provider), eq(oauthIdentities.providerSubject, sub)));
    return identity.userId;
  }

  const existing = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (existing) {
    // Never merge a human OAuth login into a service account (phase16 §4).
    if (existing.isBot || existing.isAgent) {
      throw conflict('email_reserved', 'that email belongs to a bot or agent account');
    }
    if (existing.deletedAt) {
      throw conflict('email_reserved', 'that account has been removed');
    }
    await db
      .insert(oauthIdentities)
      .values({ provider, providerSubject: sub, userId: existing.id, email, hostedDomain });
    // Linking proves address ownership, so a legacy unverified account becomes
    // verified here (same reasoning as the sign-in-link redeem).
    if (!existing.emailVerifiedAt) {
      await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, existing.id));
    }
    return existing.id;
  }

  // Provider-first account: a real verified email, no usable password. The
  // sentinel hash mirrors the `!agent:` / `!bot:` trick so `password_hash`
  // stays NOT NULL while argon2.verify can never succeed.
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id,
      email,
      passwordHash: `!${provider}:${newToken()}`,
      displayName: profile.name?.trim() || email.split('@')[0]!,
      emailVerifiedAt: new Date(),
    });
    await tx
      .insert(oauthIdentities)
      .values({ provider, providerSubject: sub, userId: id, email, hostedDomain });
  });
  return id;
}

/**
 * Domain self-registration (phase16 §4 step 3): every workspace that opened its
 * doors to this email's domain gains the user as a member. Best-effort per
 * workspace — one failure must not sink the sign-in.
 */
export async function selfRegisterByDomain(userId: string, email: string): Promise<WorkspaceDTO[]> {
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
      console.error(`oauth self-register failed for ${userId} → ${ws.slug}: ${(err as Error).message}`);
    }
  }
  return joined;
}

/** GET /v1/me/identities — what the client needs to decide whether to offer
 * the domain toggle (phase16 §5a). */
export async function listIdentities(userId: string): Promise<OAuthIdentityDTO[]> {
  const rows = await db.select().from(oauthIdentities).where(eq(oauthIdentities.userId, userId));
  return rows.map((r) => ({
    provider: r.provider as OAuthProvider,
    email: r.email,
    hostedDomain: r.hostedDomain,
    linkedAt: r.createdAt.toISOString(),
  }));
}
