// Read-only db lookups the Slack-compat surface needs but the services don't
// expose (services are owned by another workstream and imported read-only):
// channel member id lists and workspace user rows carrying is_bot/timezone.
// Callers are responsible for access checks (requireChannelAccess /
// workspace scoping via the bot's app.workspaceId).
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export type UserRow = typeof schema.users.$inferSelect;

/** All users of a workspace (bot's own workspace only), in join order. */
export async function workspaceUserRows(workspaceId: string): Promise<UserRow[]> {
  const rows = await db
    .select({ u: schema.users })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId))
    .orderBy(schema.workspaceMembers.joinedAt);
  return rows.map((r) => r.u);
}

/** One user, scoped to the workspace (null when not a member — no cross-workspace leaks). */
export async function workspaceUserRow(workspaceId: string, userId: string): Promise<UserRow | null> {
  const rows = await db
    .select({ u: schema.users })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, userId)))
    .limit(1);
  return rows[0]?.u ?? null;
}

/** Member user ids of a channel (caller must have verified channel access). */
export async function channelMemberIds(channelId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.channelMembers.userId })
    .from(schema.channelMembers)
    .where(eq(schema.channelMembers.channelId, channelId))
    .orderBy(schema.channelMembers.userId);
  return rows.map((r) => r.userId);
}
