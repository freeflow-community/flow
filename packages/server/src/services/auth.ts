import argon2 from 'argon2';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { AuthResponse, RegisterResponse, UserDTO } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { hashToken, newToken } from '../lib/tokens.js';
import { ApiError, conflict, unauthorized } from '../lib/errors.js';
import { config } from '../config.js';
import { emailSender } from '../email/index.js';

const { users, sessions, appLinkCodes, emailTokens, pendingSignups } = schema;

type TokenPurpose = 'verify_email' | 'password_reset';

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

/** Mint a single-use emailed token; any previous token of the same purpose is invalidated. */
async function mintEmailToken(userId: string, purpose: TokenPurpose, ttlMs: number): Promise<string> {
  // opportunistic cleanup, same pattern as app-link codes
  await db.delete(emailTokens).where(lt(emailTokens.expiresAt, sql`now()`));
  await db.delete(emailTokens).where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose)));
  const token = newToken();
  await db.insert(emailTokens).values({
    tokenHash: hashToken(token),
    userId,
    purpose,
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return token;
}

/** Atomically consume a token → its user row, or null if invalid/expired/wrong purpose. */
async function consumeEmailToken(token: string, purpose: TokenPurpose): Promise<typeof users.$inferSelect | null> {
  const consumed = await db
    .delete(emailTokens)
    .where(
      and(
        eq(emailTokens.tokenHash, hashToken(token)),
        eq(emailTokens.purpose, purpose),
        gt(emailTokens.expiresAt, sql`now()`),
      ),
    )
    .returning({ userId: emailTokens.userId });
  const userId = consumed[0]?.userId;
  if (!userId) return null;
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Email-first registration: the only input is the address, and the response
 * never reveals whether an account exists (no enumeration). A new address
 * gets a signup link; an existing account gets a "you already have an
 * account" note instead. Name + password are only ever set by whoever
 * clicked the link — proving address ownership first (no pre-hijacking).
 *
 * autoVerify (dev email driver only — QA scripts, dev macOS) registers in
 * one shot with password + displayName and returns a session.
 */
export async function register(
  email: string,
  opts: { password?: string | undefined; displayName?: string | undefined; autoVerify?: boolean | undefined } = {},
  clientInfo?: string,
): Promise<RegisterResponse> {
  if (opts.autoVerify === true && config.emailDriver === 'dev') {
    const passwordHash = await argon2.hash(opts.password ?? '', ARGON2_OPTS);
    const inserted = await db
      .insert(users)
      .values({
        id: newId(),
        email,
        passwordHash,
        displayName: opts.displayName ?? '',
        emailVerifiedAt: new Date(),
      })
      .onConflictDoNothing({ target: users.email })
      .returning();
    const user = inserted[0];
    if (!user) throw conflict('email_taken', 'an account with this email already exists');
    const token = await issueSession(user.id, clientInfo);
    return { token, user: toUserDTO(user) };
  }

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0] && !existing[0].isBot) {
    await emailSender().send({
      to: email,
      subject: 'You already have a Flow account',
      text:
        `Hi ${existing[0].displayName},\n\n` +
        `Someone (hopefully you) tried to create a Flow account with this address, ` +
        `but it already has one. You can sign in here:\n\n` +
        `${config.webUrlBase}/\n\n` +
        `Forgot your password? Use "Forgot password?" on the sign-in screen.\n`,
    });
  } else if (!existing[0]) {
    // re-registering while a signup is pending re-mints and resends the link
    await db.delete(pendingSignups).where(lt(pendingSignups.expiresAt, sql`now()`));
    await db.delete(pendingSignups).where(eq(pendingSignups.email, email));
    const token = newToken();
    await db.insert(pendingSignups).values({
      tokenHash: hashToken(token),
      email,
      expiresAt: new Date(Date.now() + config.verifyTokenTtlHours * 3600_000),
    });
    const link = `${config.webUrlBase}/?signup=${token}`;
    await emailSender().send({
      to: email,
      subject: 'Finish creating your Flow account',
      text:
        `Welcome to Flow!\n\n` +
        `Confirm your email address and finish setting up your account:\n\n` +
        `${link}\n\n` +
        `This link expires in ${config.verifyTokenTtlHours} hours. ` +
        `If you didn't request a Flow account, you can ignore this email.\n`,
    });
  }
  // bot addresses fall through silently — same response, no email
  return { requiresVerification: true, email };
}

/** Signup-link submit: consumes the token and creates the account (verified). */
export async function completeSignup(
  token: string,
  displayName: string,
  password: string,
  clientInfo?: string,
): Promise<AuthResponse> {
  const consumed = await db
    .delete(pendingSignups)
    .where(and(eq(pendingSignups.tokenHash, hashToken(token)), gt(pendingSignups.expiresAt, sql`now()`)))
    .returning({ email: pendingSignups.email });
  const email = consumed[0]?.email;
  if (!email) throw unauthorized('invalid or expired signup link');
  const passwordHash = await argon2.hash(password, ARGON2_OPTS);
  const inserted = await db
    .insert(users)
    .values({ id: newId(), email, passwordHash, displayName, emailVerifiedAt: new Date() })
    .onConflictDoNothing({ target: users.email })
    .returning();
  const user = inserted[0];
  if (!user) throw conflict('email_taken', 'an account with this email already exists');
  const session = await issueSession(user.id, clientInfo);
  return { token: session, user: toUserDTO(user) };
}

export async function login(email: string, password: string, clientInfo?: string): Promise<AuthResponse> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user) throw unauthorized('invalid email or password');
  const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
  if (!ok) throw unauthorized('invalid email or password');
  if (!user.emailVerifiedAt && !user.isBot) {
    // Only legacy pre-email-first accounts can be in this state; a password
    // reset (which proves address ownership) clears it.
    throw new ApiError(403, 'email_not_verified', 'this email is unverified — use "Forgot password?" to verify it');
  }
  const token = await issueSession(user.id, clientInfo);
  return { token, user: toUserDTO(user) };
}

/** Always returns ok — never reveals whether the email has an account. */
export async function forgotPassword(email: string): Promise<void> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user || user.isBot) return;
  const token = await mintEmailToken(user.id, 'password_reset', config.resetTokenTtlMinutes * 60_000);
  const link = `${config.webUrlBase}/?reset=${token}`;
  await emailSender().send({
    to: user.email,
    subject: 'Reset your Flow password',
    text:
      `Hi ${user.displayName},\n\n` +
      `Someone (hopefully you) asked to reset the password for this Flow account.\n\n` +
      `${link}\n\n` +
      `This link expires in ${config.resetTokenTtlMinutes} minutes and can be used once. ` +
      `If you didn't ask for this, you can ignore this email — your password is unchanged.\n`,
  });
}

/**
 * Reset-link submit: sets the new password, revokes every existing session,
 * and signs the user in fresh. Clicking the emailed link also proves address
 * ownership, so an unverified account becomes verified here.
 */
export async function resetPassword(token: string, newPassword: string, clientInfo?: string): Promise<AuthResponse> {
  const user = await consumeEmailToken(token, 'password_reset');
  if (!user) throw unauthorized('invalid or expired reset link');
  const passwordHash = await argon2.hash(newPassword, ARGON2_OPTS);
  await db
    .update(users)
    .set({ passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() })
    .where(eq(users.id, user.id));
  await db.delete(sessions).where(eq(sessions.userId, user.id));
  const session = await issueSession(user.id, clientInfo);
  return { token: session, user: toUserDTO(user) };
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
 * Web-to-app auth handoff (flow://signin): an authenticated (web) session
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
