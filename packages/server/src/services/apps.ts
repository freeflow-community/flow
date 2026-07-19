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

/** Create an app: bot user row + workspace membership + token (returned once). */
export async function createApp(
  workspaceId: string,
  actorId: string,
  name: string,
): Promise<{ app: AppDTO; botToken: string }> {
  await requireAdmin(workspaceId, actorId);
  const appId = newId();
  const botUserId = newId();
  const botToken = `xoxb-${newToken()}`;
  const signingSecret = randomBytes(24).toString('hex');
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: botUserId,
      email: `bot-${appId}@apps.flow.local`, // unique, never a login (random unusable hash)
      passwordHash: `!bot:${randomBytes(24).toString('hex')}`,
      displayName: name,
      isBot: true,
    });
    await tx.insert(workspaceMembers).values({ workspaceId, userId: botUserId, role: 'member' });
    await tx.insert(apps).values({
      id: appId,
      workspaceId,
      name,
      botUserId,
      botTokenHash: hashToken(botToken),
      signingSecret,
      createdBy: actorId,
    });
  });
  const created = (await db.select().from(apps).where(eq(apps.id, appId)).limit(1))[0]!;
  return { app: toAppDTO(created), botToken };
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

export async function setAppDisabled(appId: string, actorId: string, disabled: boolean): Promise<AppDTO> {
  const app = await loadAppForAdmin(appId, actorId);
  const updated = await db
    .update(apps)
    .set({ disabledAt: disabled ? new Date() : null })
    .where(eq(apps.id, app.id))
    .returning();
  return toAppDTO(updated[0]!);
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
