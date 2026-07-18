import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { ChannelDTO } from '@mychat/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { isUniqueViolation, requireMembership } from './workspaces.js';
import { publishEvent, subjectMeta } from '../bus.js';

const { channels, channelMembers, messages } = schema;

export function toChannelDTO(
  c: typeof channels.$inferSelect,
  opts: { isMember: boolean; lastReadMsgId?: string | null; unreadCount?: number },
): ChannelDTO {
  return {
    id: c.id,
    workspaceId: c.workspaceId,
    name: c.name,
    topic: c.topic,
    isPrivate: c.isPrivate,
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    archivedAt: c.archivedAt?.toISOString() ?? null,
    isMember: opts.isMember,
    lastReadMsgId: opts.lastReadMsgId ?? null,
    unreadCount: opts.unreadCount ?? 0,
  };
}

export async function createChannel(
  workspaceId: string,
  userId: string,
  name: string,
  topic?: string,
  isPrivate?: boolean,
): Promise<ChannelDTO> {
  await requireMembership(workspaceId, userId);
  const id = newId();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(channels).values({
        id,
        workspaceId,
        name,
        topic: topic ?? null,
        isPrivate: isPrivate ?? false,
        createdBy: userId,
      });
      await tx.insert(channelMembers).values({ channelId: id, userId });
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) throw conflict('channel_exists', 'a channel with this name already exists');
    throw err;
  }
  const created = (await db.select().from(channels).where(eq(channels.id, id)).limit(1))[0]!;
  const dto = toChannelDTO(created, { isMember: true });
  publishEvent(subjectMeta(workspaceId), {
    type: 'channel.created',
    workspaceId,
    channelId: id,
    ts: new Date().toISOString(),
    data: dto,
  });
  return dto;
}

/** Joined + public channels of a workspace, with unread counts for joined ones. */
export async function listChannels(workspaceId: string, userId: string): Promise<ChannelDTO[]> {
  await requireMembership(workspaceId, userId);
  const rows = await db
    .select({
      c: channels,
      lastReadMsgId: channelMembers.lastReadMsgId,
      isMember: sql<boolean>`(${channelMembers.userId} IS NOT NULL)`,
    })
    .from(channels)
    .leftJoin(
      channelMembers,
      and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, userId)),
    )
    .where(and(eq(channels.workspaceId, workspaceId), isNull(channels.archivedAt)))
    .orderBy(channels.name);

  const visible = rows.filter((r) => !r.c.isPrivate || r.isMember);
  const result: ChannelDTO[] = [];
  for (const r of visible) {
    let unreadCount = 0;
    if (r.isMember) {
      const cond = r.lastReadMsgId
        ? and(eq(messages.channelId, r.c.id), isNull(messages.threadRootId), isNull(messages.deletedAt), gt(messages.id, r.lastReadMsgId))
        : and(eq(messages.channelId, r.c.id), isNull(messages.threadRootId), isNull(messages.deletedAt));
      const cnt = await db.select({ n: sql<number>`count(*)::int` }).from(messages).where(cond);
      unreadCount = cnt[0]?.n ?? 0;
    }
    result.push(toChannelDTO(r.c, { isMember: r.isMember, lastReadMsgId: r.lastReadMsgId, unreadCount }));
  }
  return result;
}

/**
 * Channel access rule (spec §4 permissions): workspace member required;
 * private channels additionally require channel membership.
 */
export async function requireChannelAccess(channelId: string, userId: string) {
  const rows = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  const chan = rows[0];
  if (!chan) throw notFound('channel not found');
  await requireMembership(chan.workspaceId, userId);
  const mem = await db
    .select()
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
    .limit(1);
  const isMember = mem.length > 0;
  if (chan.isPrivate && !isMember) throw notFound('channel not found'); // don't leak private channels
  return { chan, isMember };
}

export async function joinChannel(channelId: string, userId: string): Promise<ChannelDTO> {
  const { chan, isMember } = await requireChannelAccess(channelId, userId);
  if (chan.isPrivate && !isMember) throw forbidden('cannot join a private channel without an invite');
  if (!isMember) {
    await db.insert(channelMembers).values({ channelId, userId }).onConflictDoNothing();
    publishEvent(subjectMeta(chan.workspaceId), {
      type: 'member.joined',
      workspaceId: chan.workspaceId,
      channelId,
      ts: new Date().toISOString(),
      data: { userId, channelId, workspaceId: chan.workspaceId },
    });
  }
  return toChannelDTO(chan, { isMember: true });
}

export async function markRead(channelId: string, userId: string, lastReadMsgId: string): Promise<void> {
  const { isMember } = await requireChannelAccess(channelId, userId);
  if (!isMember) throw forbidden('join the channel first');
  await db
    .update(channelMembers)
    .set({ lastReadMsgId })
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
}
