// Deep workspace removal for bot-like members, generalized from deleteApp
// (AGENTS_DESIGN.md: remove-agent reuses app-removal semantics).
//
// Leaves the workspace + all channels, deletes 1:1 DMs outright (a DM whose
// only other member is gone renders as a broken self-DM; group DMs just lose
// the membership), keeps the user row so message authorship keeps its name,
// and publishes the same member.left events deleteApp always has.
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { publishEvent, subjectMeta } from '../bus.js';

const { channels, channelMembers, workspaceMembers } = schema;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Remove `userId` from `workspaceId` and every channel there. `also` runs
 * inside the same transaction (deleteApp deletes the app row with it).
 */
export async function removeMemberDeep(
  workspaceId: string,
  userId: string,
  also?: (tx: Tx) => Promise<void>,
): Promise<void> {
  // The member's channels (bot-like members never join other workspaces).
  const memberChannels = await db
    .select({ id: channels.id, kind: channels.kind })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(eq(channelMembers.userId, userId));
  const dmIds = memberChannels.filter((c) => c.kind === 'dm').map((c) => c.id);
  // Human members of those DMs, captured before the cascade deletes the rows.
  const dmMembers = dmIds.length
    ? await db
        .select({ channelId: channelMembers.channelId, userId: channelMembers.userId })
        .from(channelMembers)
        .where(and(inArray(channelMembers.channelId, dmIds), ne(channelMembers.userId, userId)))
    : [];
  await db.transaction(async (tx) => {
    if (dmIds.length) await tx.delete(channels).where(inArray(channels.id, dmIds));
    await tx.delete(channelMembers).where(eq(channelMembers.userId, userId));
    await tx
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    if (also) await also(tx);
  });
  const ts = new Date().toISOString();
  // Deleted DMs: tell each human member (their sockets drop the channel).
  for (const m of dmMembers) {
    publishEvent(subjectMeta(workspaceId), {
      type: 'member.left',
      workspaceId,
      channelId: m.channelId,
      ts,
      data: { userId: m.userId, channelId: m.channelId, workspaceId },
    });
  }
  // The member leaving its remaining channels, then the workspace (no
  // channelId → clients refresh the workspace member list).
  for (const c of memberChannels.filter((ch) => ch.kind !== 'dm')) {
    publishEvent(subjectMeta(workspaceId), {
      type: 'member.left',
      workspaceId,
      channelId: c.id,
      ts,
      data: { userId, channelId: c.id, workspaceId },
    });
  }
  publishEvent(subjectMeta(workspaceId), {
    type: 'member.left',
    workspaceId,
    ts,
    data: { userId, workspaceId },
  });
}
