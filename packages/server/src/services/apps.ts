// Slack-compat app registration + bot users + bot-token auth (phase4.md §1).
//
// Bot users are real `users` rows (is_bot=true) and workspace members, so
// authorship, membership, mentions, and fan-out need zero special cases.
// Bot tokens keep the "xoxb-" prefix for Slack client-library compatibility;
// only the hash is stored, raw token shown once at creation.
import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppDTO, UserDTO } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { hashToken, newToken } from '../lib/tokens.js';
import { forbidden, notFound } from '../lib/errors.js';
import { requireMembership } from './workspaces.js';
import { removeMemberDeep } from './memberRemoval.js';
import { toUserDTO } from './auth.js';

const { apps, users, workspaceMembers } = schema;

type AppRow = typeof apps.$inferSelect;

export function toAppDTO(a: AppRow): AppDTO {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    name: a.name,
    botUserId: a.botUserId,
    eventUrl: a.eventUrl,
    eventTypes: a.eventTypes,
    createdBy: a.createdBy,
    createdAt: a.createdAt.toISOString(),
    disabledAt: a.disabledAt?.toISOString() ?? null,
    eventUrlVerified: a.eventUrlVerifiedAt !== null,
  };
}

async function requireAdmin(workspaceId: string, actorId: string) {
  const m = await requireMembership(workspaceId, actorId);
  if (m.role !== 'owner' && m.role !== 'admin') {
    throw forbidden('only owners and admins can manage apps');
  }
  return m;
}

/** Create an app: bot user row + workspace membership + credentials.
 * Bot token, app-level token (Socket Mode), AND signing secret are returned
 * here and stored (raw alongside the auth hash) so owners/admins can view
 * them later in Manage Apps (ui_nits; PM ruling pending operator review —
 * see getAppCredentials). */
export async function createApp(
  workspaceId: string,
  actorId: string,
  name: string,
): Promise<{ app: AppDTO; botToken: string; appToken: string; signingSecret: string }> {
  await requireAdmin(workspaceId, actorId);
  const appId = newId();
  const botUserId = newId();
  const botToken = `xoxb-${newToken()}`;
  const appToken = `xapp-1-${newToken()}`; // Slack-shaped prefix; SDKs only check "xapp-"
  const signingSecret = randomBytes(24).toString('hex');
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: botUserId,
      email: `bot-${appId}@apps.flow.local`, // unique, never a login (random unusable hash)
      passwordHash: `!bot:${randomBytes(24).toString('hex')}`,
      displayName: name,
      isBot: true,
      emailVerifiedAt: new Date(), // bots never do the email flow
    });
    await tx.insert(workspaceMembers).values({ workspaceId, userId: botUserId, role: 'member' });
    await tx.insert(apps).values({
      id: appId,
      workspaceId,
      name,
      botUserId,
      botTokenHash: hashToken(botToken),
      appTokenHash: hashToken(appToken),
      botToken,
      appToken,
      signingSecret,
      createdBy: actorId,
    });
  });
  const created = (await db.select().from(apps).where(eq(apps.id, appId)).limit(1))[0]!;
  return { app: toAppDTO(created), botToken, appToken, signingSecret };
}

/** App-level ("xapp-…") token → app row, for apps.connections.open. */
export async function authenticateAppToken(token: string): Promise<AppRow | null> {
  if (!token.startsWith('xapp-')) return null;
  const rows = await db
    .select()
    .from(apps)
    .where(and(eq(apps.appTokenHash, hashToken(token)), isNull(apps.disabledAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listApps(workspaceId: string, actorId: string): Promise<AppDTO[]> {
  await requireAdmin(workspaceId, actorId);
  const rows = await db.select().from(apps).where(eq(apps.workspaceId, workspaceId)).orderBy(apps.createdAt);
  return rows.map(toAppDTO);
}

async function loadAppForAdmin(appId: string, actorId: string): Promise<AppRow> {
  const rows = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
  const app = rows[0];
  if (!app) throw notFound('app not found');
  await requireAdmin(app.workspaceId, actorId);
  return app;
}

/**
 * Update event subscription config. Setting a NEW event_url stores it
 * unverified; the events module performs the url_verification challenge and
 * stamps event_url_verified_at (milestone C) — deliveries only flow once
 * verified.
 */
export async function updateApp(
  appId: string,
  actorId: string,
  patch: { eventUrl?: string | null | undefined; eventTypes?: string[] | undefined },
): Promise<AppDTO> {
  const app = await loadAppForAdmin(appId, actorId);
  const set: Partial<{
    eventUrl: string | null;
    eventUrlVerifiedAt: Date | null;
    eventTypes: string[];
  }> = {};
  if (patch.eventUrl !== undefined && patch.eventUrl !== app.eventUrl) {
    set.eventUrl = patch.eventUrl;
    set.eventUrlVerifiedAt = null;
    // Slack-style url_verification challenge, synchronous at config time; on
    // failure the URL is stored unverified (UI flags it; deliveries blocked).
    if (patch.eventUrl) {
      const { verifyEventUrl } = await import('./appEvents.js');
      if (await verifyEventUrl(patch.eventUrl, app.signingSecret)) {
        set.eventUrlVerifiedAt = new Date();
      }
    }
  }
  if (patch.eventTypes !== undefined) set.eventTypes = patch.eventTypes;
  if (Object.keys(set).length === 0) return toAppDTO(app);
  const updated = await db.update(apps).set(set).where(eq(apps.id, appId)).returning();
  return toAppDTO(updated[0]!);
}

export interface AppCredentials {
  /** null on apps created before token visibility (0011) — regenerate to view. */
  botToken: string | null;
  appToken: string | null;
  signingSecret: string;
}

/**
 * Owner/admin read of an app's credentials for the Manage Apps UI (ui_nits:
 * tokens viewable after creation). PM ruling (pending operator review): raw
 * tokens are stored next to their hashes rather than encrypted-at-rest — the
 * DB already holds the signing secret in plaintext, and an app-level
 * encryption key would live in the same env as the DB creds, so it wouldn't
 * change the threat model. Apps predating the change return null tokens.
 */
export async function getAppCredentials(appId: string, actorId: string): Promise<AppCredentials> {
  const app = await loadAppForAdmin(appId, actorId);
  return { botToken: app.botToken, appToken: app.appToken, signingSecret: app.signingSecret };
}

/**
 * Regenerate both tokens (owner/admin) — new random values replace the old
 * ones immediately (old tokens stop authenticating). Covers pre-0011 apps
 * whose raw tokens are unrecoverable, and doubles as credential rotation.
 * The signing secret is left untouched (event deliveries keep verifying).
 */
export async function rotateAppTokens(appId: string, actorId: string): Promise<AppCredentials> {
  const app = await loadAppForAdmin(appId, actorId);
  const botToken = `xoxb-${newToken()}`;
  const appToken = `xapp-1-${newToken()}`;
  await db
    .update(apps)
    .set({
      botToken,
      appToken,
      botTokenHash: hashToken(botToken),
      appTokenHash: hashToken(appToken),
    })
    .where(eq(apps.id, app.id));
  return { botToken, appToken, signingSecret: app.signingSecret };
}

export async function setAppDisabled(appId: string, actorId: string, disabled: boolean): Promise<AppDTO> {
  const app = await loadAppForAdmin(appId, actorId);
  const updated = await db
    .update(apps)
    .set({ disabledAt: disabled ? new Date() : null })
    .where(eq(apps.id, app.id))
    .returning();
  return toAppDTO(updated[0]!);
}

/**
 * Remove an app entirely (Slack "uninstall"). The app row is deleted
 * (credentials + queued deliveries die via cascade) and its bot user is
 * pulled out of the workspace so it stops appearing in member and mention
 * lists. 1:1 DMs with the bot are deleted outright — a DM whose only other
 * member is gone renders as a broken self-DM; standard/group-DM channels
 * just lose the bot's membership. The bot's user row survives so message
 * authorship keeps its name.
 */
export async function deleteApp(appId: string, actorId: string): Promise<void> {
  const app = await loadAppForAdmin(appId, actorId);
  await removeMemberDeep(app.workspaceId, app.botUserId, async (tx) => {
    await tx.delete(apps).where(eq(apps.id, app.id));
  });
}

/** Events module marks a URL verified after the challenge round-trip. */
export async function markEventUrlVerified(appId: string): Promise<void> {
  await db.update(apps).set({ eventUrlVerifiedAt: new Date() }).where(eq(apps.id, appId));
}

export interface BotAuth {
  app: AppRow;
  botUser: UserDTO;
}

/**
 * Bot-token auth for the /api compat surface. Tokens are "xoxb-…"; disabled
 * apps fail auth (Slack: account_inactive / invalid_auth family).
 */
export async function authenticateBot(token: string): Promise<BotAuth | null> {
  if (!token.startsWith('xoxb-')) return null;
  const rows = await db
    .select({ app: apps, user: users })
    .from(apps)
    .innerJoin(users, eq(users.id, apps.botUserId))
    .where(and(eq(apps.botTokenHash, hashToken(token)), isNull(apps.disabledAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { app: row.app, botUser: toUserDTO(row.user) };
}
