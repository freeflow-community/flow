import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { FileDTO, MessageDTO, MessagePage, ReactionAggDTO, SystemMessageKind, UnfurlDTO } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { decryptBody, encryptBody } from '../crypto/index.js';
import { requireChannelAccess } from './channels.js';
import { reactionsForMessages } from './reactions.js';
import { filesForMessages, validateAttachments, toFileDTO } from './files.js';
import { computeRecipients, insertNotifications, publishNotifications } from './notifications.js';
import { enqueueMessageEvents } from './appEvents.js';
import { publishEvent, subjectMsg } from '../bus.js';
import { scheduleForMessage, unfurlsForMessages } from './unfurl/index.js';

const { messages, channelMembers, messageFiles } = schema;

type MessageRow = typeof messages.$inferSelect;
export type HydratedMessageRow = MessageRow;

interface DtoExtras {
  reactions?: ReactionAggDTO[] | undefined;
  files?: FileDTO[] | undefined;
  replyParticipants?: string[] | undefined;
  unfurls?: UnfurlDTO[] | undefined;
}

export function toMessageDTO(row: MessageRow, extras?: DtoExtras): MessageDTO {
  return {
    id: row.id,
    channelId: row.channelId,
    userId: row.userId,
    threadRootId: row.threadRootId,
    clientMsgId: row.clientMsgId,
    body: row.deletedAt ? '' : decryptBody(row),
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    systemKind: (row.systemKind as MessageDTO['systemKind']) ?? null,
    replyCount: row.replyCount,
    lastReplyAt: row.lastReplyAt?.toISOString() ?? null,
    replyParticipantUserIds: extras?.replyParticipants ?? [],
    reactions: extras?.reactions ?? [],
    files: extras?.files ?? [],
    unfurls: extras?.unfurls ?? [],
  };
}

/** Reply-avatar stack cap (phase5.md item 7): first 4 distinct authors per thread. */
const REPLY_PARTICIPANTS_MAX = 4;

/**
 * First (up to) 4 distinct reply authors per thread root, in order of each
 * author's first reply (message ids are uuidv7 → time-ordered). Grouped query
 * over the roots on the page, same shape as reactions/files hydration.
 */
async function replyParticipantsForRoots(rows: MessageRow[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const rootIds = rows.filter((r) => r.threadRootId === null && r.replyCount > 0).map((r) => r.id);
  if (rootIds.length === 0) return out;
  // Postgres has no min(uuid) aggregate; DISTINCT ON picks each author's
  // first reply instead, then JS orders authors by that reply and caps at 4.
  const grouped = await db
    .selectDistinctOn([messages.threadRootId, messages.userId], {
      rootId: messages.threadRootId,
      userId: messages.userId,
      firstId: messages.id,
    })
    .from(messages)
    .where(inArray(messages.threadRootId, rootIds))
    .orderBy(asc(messages.threadRootId), asc(messages.userId), asc(messages.id));
  grouped.sort((a, b) => (a.firstId < b.firstId ? -1 : 1));
  for (const r of grouped) {
    const list = out.get(r.rootId!) ?? [];
    if (list.length < REPLY_PARTICIPANTS_MAX) {
      list.push(r.userId);
      out.set(r.rootId!, list);
    }
  }
  return out;
}

/** Page hydration (phase2.md §2/§3): one grouped reactions query + one files join per page. */
async function hydrate(rows: MessageRow[]): Promise<MessageDTO[]> {
  const ids = rows.map((r) => r.id);
  const [reactions, files, participants, unfurls] = await Promise.all([
    reactionsForMessages(ids),
    filesForMessages(ids),
    replyParticipantsForRoots(rows),
    unfurlsForMessages(ids),
  ]);
  return rows.map((r) =>
    toMessageDTO(r, {
      reactions: reactions.get(r.id),
      files: files.get(r.id),
      replyParticipants: participants.get(r.id),
      unfurls: unfurls.get(r.id),
    }),
  );
}

/**
 * Send message (spec write path): validate → insert (encrypted) + attach files
 * + write notification rows, one transaction → publish. Public channels:
 * auto-join on first post. Idempotent on (channel, clientMsgId).
 */
export async function sendMessage(
  channelId: string,
  userId: string,
  clientMsgId: string,
  body: string,
  threadRootId?: string,
  fileIds?: string[],
  mentions?: string[],
): Promise<MessageDTO> {
  const { chan, isMember } = await requireChannelAccess(channelId, userId);
  if (chan.archivedAt) throw badRequest('channel_archived', 'channel is archived');
  if (!isMember) {
    // public channel, first post → auto-join (spec permission rules)
    await db.insert(channelMembers).values({ channelId, userId }).onConflictDoNothing();
  }

  // idempotency: return the existing row for a retried clientMsgId
  const existing = await db
    .select()
    .from(messages)
    .where(and(eq(messages.channelId, channelId), eq(messages.clientMsgId, clientMsgId)))
    .limit(1);
  if (existing[0]) return (await hydrate([existing[0]]))[0]!;

  if (threadRootId) {
    const roots = await db.select().from(messages).where(eq(messages.id, threadRootId)).limit(1);
    const root = roots[0];
    if (!root || root.channelId !== channelId) throw badRequest('bad_thread_root', 'thread root not found in this channel');
    if (root.threadRootId !== null) throw badRequest('bad_thread_root', 'replies must target the thread root (one level deep)');
    if (root.deletedAt) throw badRequest('bad_thread_root', 'cannot reply to a deleted message');
  }

  const attachRows = await validateAttachments(fileIds ?? [], chan.workspaceId, userId);
  const { recipients, alertContext } = await computeRecipients(chan, userId, body, mentions ?? [], threadRootId);

  const id = newId();
  const enc = encryptBody(body);
  const now = new Date();

  let row: MessageRow | undefined;
  let planned: Awaited<ReturnType<typeof insertNotifications>> = [];
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(messages)
      .values({
        id,
        channelId,
        userId,
        threadRootId: threadRootId ?? null,
        clientMsgId,
        body: enc.body,
        bodyNonce: enc.bodyNonce,
        encKeyId: enc.encKeyId,
        encScheme: enc.encScheme,
        createdAt: now,
      })
      .onConflictDoNothing({ target: [messages.channelId, messages.clientMsgId] })
      .returning();
    row = inserted[0];
    if (!row) return; // lost the race; handled below
    if (threadRootId) {
      // denormalized thread rollup on the root, same txn (spec design note)
      await tx
        .update(messages)
        .set({ replyCount: sql`${messages.replyCount} + 1`, lastReplyAt: now })
        .where(eq(messages.id, threadRootId));
    }
    if (attachRows.length > 0) {
      await tx.insert(messageFiles).values(attachRows.map((f) => ({ messageId: id, fileId: f.id })));
    }
    if (!threadRootId) {
      // Posting in a channel means you've seen what's above it — advance the
      // sender's read cursor so the channel doesn't badge on their other
      // clients (#71). `greatest` ignores NULLs and never moves it backwards.
      await tx
        .update(channelMembers)
        .set({ lastReadMsgId: sql`greatest(${channelMembers.lastReadMsgId}, ${id}::uuid)` })
        .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
    }
    // notification rows in the same transaction (phase2.md §4)
    planned = await insertNotifications(tx, recipients, id, channelId);
    // Slack-compat Events API outbox rows, same transaction (phase4.md §1)
    await enqueueMessageEvents(
      tx,
      chan,
      { id, userId, body, threadRootId: threadRootId ?? null },
      mentions ?? [],
    );
  });

  if (!row) {
    // lost a concurrent-insert race: fetch the winner (same clientMsgId)
    const winner = await db
      .select()
      .from(messages)
      .where(and(eq(messages.channelId, channelId), eq(messages.clientMsgId, clientMsgId)))
      .limit(1);
    return (await hydrate([winner[0]!]))[0]!;
  }

  const dto = toMessageDTO(row, { files: attachRows.map(toFileDTO) });
  publishEvent(subjectMsg(chan.workspaceId, channelId), {
    type: threadRootId ? 'thread.reply' : 'message.created',
    workspaceId: chan.workspaceId,
    channelId,
    ts: now.toISOString(),
    data: dto,
  });
  publishNotifications(planned, alertContext, dto, chan.workspaceId, now.toISOString());
  // §1: never blocks the send path — cards arrive later via message.updated.
  void scheduleForMessage(dto);
  return dto;
}

const SYSTEM_PREDICATE: Record<SystemMessageKind, string> = {
  member_joined: 'joined the channel',
  member_left: 'left the channel',
};

/**
 * Post an inline channel-event line ("Alice joined the channel") — a normal
 * `messages` row authored by the subject user, tagged with `systemKind` so
 * clients render it as a centered muted notice. Unlike sendMessage it creates
 * no notifications, no Slack-events outbox rows, and no unfurls, and it never
 * throws into the caller's path: membership writes must not fail because the
 * courtesy notice couldn't be posted. Only standard channels get these.
 *
 * The body is the pre-rendered sentence so every client (and scroll-back
 * history) reads correctly without a live member lookup; the name reflects the
 * user at the moment of the event, which is what we want.
 */
export async function postSystemMessage(
  chan: { id: string; workspaceId: string; kind: string },
  subjectUserId: string,
  kind: SystemMessageKind,
): Promise<void> {
  if (chan.kind !== 'standard') return;
  try {
    const who = await db
      .select({ displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.id, subjectUserId))
      .limit(1);
    const name = who[0]?.displayName ?? 'Someone';
    const body = `${name} ${SYSTEM_PREDICATE[kind]}`;
    const id = newId();
    const now = new Date();
    const enc = encryptBody(body);
    const inserted = await db
      .insert(messages)
      .values({
        id,
        channelId: chan.id,
        userId: subjectUserId,
        threadRootId: null,
        clientMsgId: newId(),
        body: enc.body,
        bodyNonce: enc.bodyNonce,
        encKeyId: enc.encKeyId,
        encScheme: enc.encScheme,
        createdAt: now,
        systemKind: kind,
      })
      .returning();
    const row = inserted[0];
    if (!row) return;
    publishEvent(subjectMsg(chan.workspaceId, chan.id), {
      type: 'message.created',
      workspaceId: chan.workspaceId,
      channelId: chan.id,
      ts: now.toISOString(),
      data: toMessageDTO(row),
    });
  } catch (err) {
    // Best-effort: a failed courtesy line must not abort the join/leave.
    console.error('postSystemMessage failed', { channelId: chan.id, kind, err });
  }
}

/** Single hydrated message; used by the unfurl worker to republish. */
export async function getMessageById(messageId: string): Promise<MessageDTO | null> {
  const rows = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!rows[0]) return null;
  return (await hydrate([rows[0]]))[0] ?? null;
}

/** Channel history: top-level messages, newest first, cursor on id (spec §2 index). */
export async function listMessages(
  channelId: string,
  userId: string,
  before: string | undefined,
  limit: number,
): Promise<MessagePage> {
  await requireChannelAccess(channelId, userId);
  const conds = [eq(messages.channelId, channelId), isNull(messages.threadRootId)];
  if (before) conds.push(lt(messages.id, before));
  const rows = await db
    .select()
    .from(messages)
    .where(and(...conds))
    .orderBy(desc(messages.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  return { messages: await hydrate(rows.slice(0, limit)), hasMore };
}

/** Thread view: root + replies ascending, cursor after=<msgId>. */
export async function listThread(
  rootId: string,
  userId: string,
  after: string | undefined,
  limit: number,
): Promise<MessagePage & { root: MessageDTO }> {
  const roots = await db.select().from(messages).where(eq(messages.id, rootId)).limit(1);
  const root = roots[0];
  if (!root) throw notFound('message not found');
  if (root.threadRootId) throw badRequest('not_a_root', 'message is not a thread root');
  await requireChannelAccess(root.channelId, userId);

  const conds = [eq(messages.threadRootId, rootId)];
  if (after) conds.push(gt(messages.id, after));
  const rows = await db
    .select()
    .from(messages)
    .where(and(...conds))
    .orderBy(asc(messages.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const [rootDto, replyDtos] = await Promise.all([hydrate([root]), hydrate(rows.slice(0, limit))]);
  return { root: rootDto[0]!, messages: replyDtos, hasMore };
}

/**
 * Only the author edits own messages (spec permission rules). Re-encrypts.
 * Edits do not create new notifications (deliberate: re-notifying on every
 * typo fix is noise; matches the write-time parse model).
 */
export async function editMessage(messageId: string, userId: string, body: string): Promise<MessageDTO> {
  const rows = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  const row = rows[0];
  if (!row) throw notFound('message not found');
  const { chan } = await requireChannelAccess(row.channelId, userId);
  if (row.userId !== userId) throw forbidden('only the author can edit a message');
  if (row.deletedAt) throw badRequest('message_deleted', 'cannot edit a deleted message');

  const enc = encryptBody(body);
  const editedAt = new Date();
  const updated = await db
    .update(messages)
    .set({ body: enc.body, bodyNonce: enc.bodyNonce, encKeyId: enc.encKeyId, encScheme: enc.encScheme, editedAt })
    .where(eq(messages.id, messageId))
    .returning();
  const dto = (await hydrate([updated[0]!]))[0]!;
  publishEvent(subjectMsg(chan.workspaceId, row.channelId), {
    type: 'message.updated',
    workspaceId: chan.workspaceId,
    channelId: row.channelId,
    ts: editedAt.toISOString(),
    data: dto,
  });
  // §1: an edit can introduce new links. Already-attached and tombstoned
  // hashes are skipped inside, so this is safe to call on every edit.
  void scheduleForMessage(dto);
  return dto;
}

/**
 * Delete a message. Default is a soft delete: body overwritten with empty
 * ciphertext, row kept, `deletedAt` set (spec §2) — clients render a tombstone.
 *
 * `hard` fully removes the row (child reactions/files/notifications cascade)
 * and publishes `message.purged` so clients drop it with no tombstone. Used by
 * the agent-bridge for its ephemeral "thinking…" status message, whose whole
 * point is to vanish on completion — a soft delete would leave a stray
 * "This message was deleted" line above the real reply.
 */
export async function deleteMessage(
  messageId: string,
  userId: string,
  opts?: { hard?: boolean },
): Promise<void> {
  const rows = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  const row = rows[0];
  if (!row) {
    if (opts?.hard) return; // idempotent: already gone is the goal state
    throw notFound('message not found');
  }
  const { chan } = await requireChannelAccess(row.channelId, userId);
  if (row.userId !== userId) throw forbidden('only the author can delete a message');

  if (opts?.hard) {
    await db.transaction(async (tx) => {
      await tx.delete(messages).where(eq(messages.id, messageId));
      // Fix the root's denormalized rollup if this was a thread reply
      // (participants are computed at query time, so they self-correct). The
      // delete above already ran in this txn, so the subquery sees survivors
      // only — lastReplyAt drops to the newest remaining reply, or NULL.
      if (row.threadRootId) {
        await tx
          .update(messages)
          .set({
            replyCount: sql`greatest(${messages.replyCount} - 1, 0)`,
            lastReplyAt: sql`(select max(m.created_at) from ${messages} m where m.thread_root_id = ${row.threadRootId}::uuid)`,
          })
          .where(eq(messages.id, row.threadRootId));
      }
    });
    publishEvent(subjectMsg(chan.workspaceId, row.channelId), {
      type: 'message.purged',
      workspaceId: chan.workspaceId,
      channelId: row.channelId,
      ts: new Date().toISOString(),
      data: toMessageDTO(row),
    });
    return;
  }

  if (row.deletedAt) return; // idempotent

  const enc = encryptBody('');
  const deletedAt = new Date();
  const updated = await db
    .update(messages)
    .set({ body: enc.body, bodyNonce: enc.bodyNonce, encKeyId: enc.encKeyId, encScheme: enc.encScheme, deletedAt })
    .where(eq(messages.id, messageId))
    .returning();
  publishEvent(subjectMsg(chan.workspaceId, row.channelId), {
    type: 'message.deleted',
    workspaceId: chan.workspaceId,
    channelId: row.channelId,
    ts: deletedAt.toISOString(),
    data: toMessageDTO(updated[0]!),
  });
}
