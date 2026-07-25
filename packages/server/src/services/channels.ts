import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { ChannelDTO, ChannelKind, NotifyLevel } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { isUniqueViolation, requireMembership } from './workspaces.js';
import { enqueueChannelEvent, enqueueMemberEvent } from './appEvents.js';
import { postSystemMessage } from './messages.js';
import { publishEvent, subjectMeta } from '../bus.js';

const { channels, channelMembers, messages, workspaceMembers } = schema;

type ChannelRow = typeof channels.$inferSelect;

export function toChannelDTO(
  c: ChannelRow,
  opts: {
    isMember: boolean;
    lastReadMsgId?: string | null | undefined;
    unreadCount?: number | undefined;
    notifyLevel?: number | undefined;
    memberIds?: string[] | undefined;
  },
): ChannelDTO {
  const dto: ChannelDTO = {
    id: c.id,
    workspaceId: c.workspaceId,
    name: c.name,
    kind: c.kind as ChannelKind,
    topic: c.topic,
    isPrivate: c.isPrivate,
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    archivedAt: c.archivedAt?.toISOString() ?? null,
    isMember: opts.isMember,
    lastReadMsgId: opts.lastReadMsgId ?? null,
    unreadCount: opts.unreadCount ?? 0,
    notifyLevel: (opts.notifyLevel ?? 1) as NotifyLevel,
  };
  if (opts.memberIds) dto.memberIds = opts.memberIds;
  return dto;
}

async function dmMemberIds(channelIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (channelIds.length === 0) return out;
  const rows = await db
    .select({ channelId: channelMembers.channelId, userId: channelMembers.userId })
    .from(channelMembers)
    .where(inArray(channelMembers.channelId, channelIds))
    .orderBy(asc(channelMembers.userId));
  for (const r of rows) {
    const list = out.get(r.channelId) ?? [];
    list.push(r.userId);
    out.set(r.channelId, list);
  }
  return out;
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
      const created = (await tx.select().from(channels).where(eq(channels.id, id)).limit(1))[0]!;
      await enqueueChannelEvent(tx, created, 'channel_created', userId);
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

/**
 * DM upsert (phase2.md §1): one DM channel per member set per workspace.
 * The caller is implicitly a member; dm_key = sorted member ids joined with ':'.
 * Races resolve via the chan_dm_key unique index — loser re-selects the winner.
 */
export async function createDm(workspaceId: string, callerId: string, otherUserIds: string[]): Promise<ChannelDTO> {
  await requireMembership(workspaceId, callerId);
  const memberIds = [...new Set([callerId, ...otherUserIds])].sort();
  // every target must be a workspace member
  const memRows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.userId, memberIds)));
  if (memRows.length !== memberIds.length) {
    throw badRequest('bad_user', 'all DM recipients must be members of this workspace');
  }
  const dmKey = memberIds.join(':');
  const kind: ChannelKind = memberIds.length <= 2 ? 'dm' : 'group_dm';

  const fetchExisting = async (): Promise<ChannelRow | undefined> =>
    (
      await db
        .select()
        .from(channels)
        .where(and(eq(channels.workspaceId, workspaceId), eq(channels.dmKey, dmKey)))
        .limit(1)
    )[0];

  const existing = await fetchExisting();
  if (existing) {
    const mem = await db
      .select({ lastReadMsgId: channelMembers.lastReadMsgId, notifyLevel: channelMembers.notifyLevel })
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, existing.id), eq(channelMembers.userId, callerId)))
      .limit(1);
    return toChannelDTO(existing, {
      isMember: true,
      lastReadMsgId: mem[0]?.lastReadMsgId,
      notifyLevel: mem[0]?.notifyLevel,
      memberIds,
    });
  }

  const id = newId();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(channels).values({
        id,
        workspaceId,
        name: null,
        kind,
        dmKey,
        isPrivate: true, // always private (phase2.md §1)
        createdBy: callerId,
      });
      await tx.insert(channelMembers).values(memberIds.map((uid) => ({ channelId: id, userId: uid })));
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      const winner = await fetchExisting();
      if (winner) return toChannelDTO(winner, { isMember: true, memberIds });
    }
    throw err;
  }

  const created = (await db.select().from(channels).where(eq(channels.id, id)).limit(1))[0]!;
  const dto = toChannelDTO(created, { isMember: true, memberIds });
  const ts = new Date().toISOString();
  // channel.created tells the creator's sockets; member.joined (one per member)
  // updates every participant's gateway membership cache and prompts clients to
  // refresh their channel list (same contract as channel joins).
  publishEvent(subjectMeta(workspaceId), {
    type: 'channel.created',
    workspaceId,
    channelId: id,
    ts,
    data: dto,
  });
  for (const uid of memberIds) {
    publishEvent(subjectMeta(workspaceId), {
      type: 'member.joined',
      workspaceId,
      channelId: id,
      ts,
      data: { userId: uid, channelId: id, workspaceId },
    });
  }
  return dto;
}

/** Joined + public channels of a workspace, with unread counts for joined ones. */
export async function listChannels(workspaceId: string, userId: string): Promise<ChannelDTO[]> {
  await requireMembership(workspaceId, userId);
  const rows = await db
    .select({
      c: channels,
      lastReadMsgId: channelMembers.lastReadMsgId,
      notifyLevel: channelMembers.notifyLevel,
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
  const dmIds = visible.filter((r) => r.c.kind !== 'standard').map((r) => r.c.id);
  const dmMembers = await dmMemberIds(dmIds);
  const result: ChannelDTO[] = [];
  for (const r of visible) {
    let unreadCount = 0;
    if (r.isMember) {
      // System lines (join/leave) never contribute to unread — they're courtesy
      // notices, not messages you need to catch up on. Neither do your own
      // messages: you can't have unread mail from yourself, and the read cursor
      // may not have caught up if you sent from another client (#71).
      const base = and(
        eq(messages.channelId, r.c.id),
        isNull(messages.threadRootId),
        isNull(messages.deletedAt),
        isNull(messages.systemKind),
        ne(messages.userId, userId),
      );
      const cond = r.lastReadMsgId ? and(base, gt(messages.id, r.lastReadMsgId)) : base;
      const cnt = await db.select({ n: sql<number>`count(*)::int` }).from(messages).where(cond);
      unreadCount = cnt[0]?.n ?? 0;
    }
    result.push(
      toChannelDTO(r.c, {
        isMember: r.isMember,
        lastReadMsgId: r.lastReadMsgId,
        unreadCount,
        notifyLevel: r.notifyLevel ?? 1,
        memberIds: r.c.kind !== 'standard' ? (dmMembers.get(r.c.id) ?? []) : undefined,
      }),
    );
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

/** Member user ids of a channel the caller can access (mention CTA, invite lists). */
export async function listMemberIds(channelId: string, callerId: string): Promise<string[]> {
  await requireChannelAccess(channelId, callerId);
  const rows = await db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, channelId));
  return rows.map((r) => r.userId);
}

export async function joinChannel(channelId: string, userId: string): Promise<ChannelDTO> {
  const { chan, isMember } = await requireChannelAccess(channelId, userId);
  if (chan.kind !== 'standard') throw badRequest('dm_channel', 'cannot join a DM via channel endpoints');
  if (chan.archivedAt) throw badRequest('channel_archived', 'channel is archived');
  if (chan.isPrivate && !isMember) throw forbidden('cannot join a private channel without an invite');
  if (!isMember) {
    await db.transaction(async (tx) => {
      const ins = await tx.insert(channelMembers).values({ channelId, userId }).onConflictDoNothing().returning();
      if (ins.length > 0) await enqueueMemberEvent(tx, chan, true, userId);
    });
    publishEvent(subjectMeta(chan.workspaceId), {
      type: 'member.joined',
      workspaceId: chan.workspaceId,
      channelId,
      ts: new Date().toISOString(),
      data: { userId, channelId, workspaceId: chan.workspaceId },
    });
    await postSystemMessage(chan, userId, 'member_joined');
  }
  return toChannelDTO(chan, { isMember: true });
}

/**
 * Invite/add a member (phase2.md §5): private channels → any existing channel
 * member may add; public channels → any workspace member may add. Target must
 * be a workspace member. DMs never gain members this way (a wider group DM is
 * a new channel, §1).
 */
export async function addMember(channelId: string, actorId: string, targetUserId: string): Promise<void> {
  const { chan, isMember } = await requireChannelAccess(channelId, actorId);
  if (chan.kind !== 'standard') throw badRequest('dm_channel', 'DM membership is fixed; start a new group DM instead');
  if (chan.archivedAt) throw badRequest('channel_archived', 'channel is archived');
  if (chan.isPrivate && !isMember) throw forbidden('only channel members can invite to a private channel');
  const target = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, chan.workspaceId), eq(workspaceMembers.userId, targetUserId)))
    .limit(1);
  if (!target[0]) throw badRequest('bad_user', 'user is not a member of this workspace');
  const inserted = await db.transaction(async (tx) => {
    const ins = await tx
      .insert(channelMembers)
      .values({ channelId, userId: targetUserId })
      .onConflictDoNothing()
      .returning();
    if (ins.length > 0) await enqueueMemberEvent(tx, chan, true, targetUserId);
    return ins;
  });
  if (inserted.length > 0) {
    publishEvent(subjectMeta(chan.workspaceId), {
      type: 'member.joined',
      workspaceId: chan.workspaceId,
      channelId,
      ts: new Date().toISOString(),
      data: { userId: targetUserId, channelId, workspaceId: chan.workspaceId },
    });
    await postSystemMessage(chan, targetUserId, 'member_joined');
  }
}

/**
 * Remove a member (phase2.md §5): self-removal is "leave"; removing someone
 * else requires workspace admin/owner (with channel access). Leaving is
 * allowed for group DMs but not 1:1 DMs (§1).
 */
export async function removeMember(channelId: string, actorId: string, targetUserId: string): Promise<void> {
  const { chan, isMember } = await requireChannelAccess(channelId, actorId);
  const self = actorId === targetUserId;
  if (chan.kind === 'dm') throw badRequest('dm_channel', 'cannot leave a 1:1 DM');
  if (chan.kind === 'group_dm' && !self) throw forbidden('group DM members can only remove themselves');
  if (self) {
    if (!isMember) throw badRequest('not_member', 'not a member of this channel');
    if (chan.kind === 'standard' && chan.name === 'general') throw badRequest('general_channel', 'cannot leave #general');
  } else {
    const actor = await requireMembership(chan.workspaceId, actorId);
    if (actor.role !== 'owner' && actor.role !== 'admin') throw forbidden('only owners and admins can remove members');
  }
  const deleted = await db.transaction(async (tx) => {
    const del = await tx
      .delete(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, targetUserId)))
      .returning();
    if (del.length > 0 && chan.kind === 'standard') await enqueueMemberEvent(tx, chan, false, targetUserId);
    return del;
  });
  if (deleted.length > 0) {
    publishEvent(subjectMeta(chan.workspaceId), {
      type: 'member.left',
      workspaceId: chan.workspaceId,
      channelId,
      ts: new Date().toISOString(),
      data: { userId: targetUserId, channelId, workspaceId: chan.workspaceId },
    });
    await postSystemMessage(chan, targetUserId, 'member_left');
  }
}

/**
 * Rename / set topic (ui_nits item 5). Any channel member may edit — matches
 * Slack's default and the codebase's permissive rule for non-destructive ops
 * (decision_log 2026-07-19). Empty topic clears it; #general keeps its name.
 */
export async function updateChannel(
  channelId: string,
  actorId: string,
  patch: { name?: string | undefined; topic?: string | undefined },
): Promise<ChannelDTO> {
  const { chan, isMember } = await requireChannelAccess(channelId, actorId);
  if (chan.kind !== 'standard') throw badRequest('dm_channel', 'DMs have no name or topic');
  if (chan.archivedAt) throw badRequest('channel_archived', 'channel is archived');
  if (!isMember) throw forbidden('join the channel first');
  if (patch.name !== undefined && chan.name === 'general' && patch.name !== 'general') {
    throw badRequest('general_channel', 'cannot rename #general');
  }
  const set: { name?: string; topic?: string | null } = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.topic !== undefined) set.topic = patch.topic === '' ? null : patch.topic;
  let updated: ChannelRow;
  try {
    updated = (await db.update(channels).set(set).where(eq(channels.id, channelId)).returning())[0]!;
  } catch (err: unknown) {
    if (isUniqueViolation(err)) throw conflict('channel_exists', 'a channel with this name already exists');
    throw err;
  }
  const dto = toChannelDTO(updated, { isMember });
  publishEvent(subjectMeta(chan.workspaceId), {
    type: 'channel.updated',
    workspaceId: chan.workspaceId,
    channelId,
    ts: new Date().toISOString(),
    data: dto,
  });
  return dto;
}

/** Archive (phase2.md §5): workspace admin/owner or the channel creator. Read-only afterwards. */
export async function archiveChannel(channelId: string, actorId: string): Promise<ChannelDTO> {
  const { chan, isMember } = await requireChannelAccess(channelId, actorId);
  if (chan.kind !== 'standard') throw badRequest('dm_channel', 'DMs cannot be archived');
  if (chan.name === 'general') throw badRequest('general_channel', 'cannot archive #general');
  const actor = await requireMembership(chan.workspaceId, actorId);
  const allowed = actor.role === 'owner' || actor.role === 'admin' || chan.createdBy === actorId;
  if (!allowed) throw forbidden('only owners, admins, or the channel creator can archive');
  if (chan.archivedAt) return toChannelDTO(chan, { isMember }); // idempotent
  const updated = await db.transaction(async (tx) => {
    const up = await tx
      .update(channels)
      .set({ archivedAt: new Date() })
      .where(eq(channels.id, channelId))
      .returning();
    await enqueueChannelEvent(tx, up[0]!, 'channel_archive', actorId);
    return up;
  });
  const dto = toChannelDTO(updated[0]!, { isMember });
  publishEvent(subjectMeta(chan.workspaceId), {
    type: 'channel.archived',
    workspaceId: chan.workspaceId,
    channelId,
    ts: new Date().toISOString(),
    data: dto,
  });
  return dto;
}

/** Per-user notify level (operator ruling, decision log 2026-07-18): 0=mute 1=mentions 2=all. */
export async function setNotifyLevel(channelId: string, userId: string, level: 0 | 1 | 2): Promise<void> {
  const { isMember } = await requireChannelAccess(channelId, userId);
  if (!isMember) throw forbidden('join the channel first');
  await db
    .update(channelMembers)
    .set({ notifyLevel: level })
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
}

export async function markRead(channelId: string, userId: string, lastReadMsgId: string): Promise<void> {
  const { isMember } = await requireChannelAccess(channelId, userId);
  if (!isMember) throw forbidden('join the channel first');
  await db
    .update(channelMembers)
    .set({ lastReadMsgId })
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
}
