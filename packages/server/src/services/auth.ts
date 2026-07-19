import argon2 from 'argon2';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { AuthResponse, UserDTO } from '@mychat/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { hashToken, newToken } from '../lib/tokens.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { config } from '../config.js';

const { users, sessions, appLinkCodes } = schema;

/** Web-to-app handoff codes are single-use and short-lived. */
const APP_LINK_TTL_MS = 2 * 60_000;

const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB — OWASP recommended argon2id baseline
  timeCost: 2,
  parallelism: 1,
};

export function toUserDTO(u: typeof users.$inferSelect): UserDTO {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    timezone: u.timezone,
    statusEmoji: u.statusEmoji,
    statusText: u.statusText,
    createdAt: u.createdAt.toISOString(),
  };
}

async function issueSession(userId: string, clientInfo?: string): Promise<string> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86400_000);
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
    clientInfo: clientInfo ?? null,
  });
  return token;
}

export async function register(
  email: string,
  password: string,
  displayName: string,
  clientInfo?: string,
): Promise<AuthResponse> {
  const passwordHash = await argon2.hash(password, ARGON2_OPTS);
  const id = newId();
  const inserted = await db
    .insert(users)
    .values({ id, email, passwordHash, displayName })
    .onConflictDoNothing({ target: users.email })
    .returning();
  const user = inserted[0];
  if (!user) throw conflict('email_taken', 'an account with this email already exists');
  const token = await issueSession(user.id, clientInfo);
  return { token, user: toUserDTO(user) };
}

export async function login(email: string, password: string, clientInfo?: string): Promise<AuthResponse> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user) throw unauthorized('invalid email or password');
  const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
  if (!ok) throw unauthorized('invalid email or password');
  const token = await issueSession(user.id, clientInfo);
  return { token, user: toUserDTO(user) };
}

export async function logout(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/**
 * Validate a bearer token → user. Sliding 30-day expiry: when a session is
 * used with < 29 days remaining, extend to 30 (cheap: at most one write/day).
 */
export async function authenticate(token: string): Promise<UserDTO> {
  const tokenHash = hashToken(token);
  const now = new Date();
  const rows = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row) throw unauthorized();
  const slideThreshold = new Date(now.getTime() + (config.sessionTtlDays - 1) * 86400_000);
  if (row.expiresAt < slideThreshold) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now.getTime() + config.sessionTtlDays * 86400_000) })
      .where(and(eq(sessions.tokenHash, tokenHash), lt(sessions.expiresAt, slideThreshold)));
  }
  return toUserDTO(row.user);
}

/**
 * Web-to-app auth handoff (myapp://signin): an authenticated (web) session
 * mints a one-time code the native app exchanges for its own session. The
 * raw session token never rides in the deep-link URL.
 */
export async function createAppLink(userId: string): Promise<{ code: string; expiresAt: string }> {
  // opportunistic cleanup — the table only ever holds in-flight handoffs
  await db.delete(appLinkCodes).where(lt(appLinkCodes.expiresAt, sql`now()`));
  const code = newToken();
  const expiresAt = new Date(Date.now() + APP_LINK_TTL_MS);
  await db.insert(appLinkCodes).values({ codeHash: hashToken(code), userId, expiresAt });
  return { code, expiresAt: expiresAt.toISOString() };
}

/** Single-use exchange: atomically consumes the code, then issues a session. */
export async function exchangeAppLink(code: string, clientInfo?: string): Promise<AuthResponse> {
  const consumed = await db
    .delete(appLinkCodes)
    .where(and(eq(appLinkCodes.codeHash, hashToken(code)), gt(appLinkCodes.expiresAt, sql`now()`)))
    .returning({ userId: appLinkCodes.userId });
  const userId = consumed[0]?.userId;
  if (!userId) throw unauthorized('invalid or expired app link code');
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) throw unauthorized('invalid or expired app link code');
  const token = await issueSession(user.id, clientInfo);
  return { token, user: toUserDTO(user) };
}

/** Purge expired sessions (called opportunistically at boot). */
export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, sql`now()`));
}
