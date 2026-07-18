import { and, asc, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { FileDTO, MessageDTO, MessagePage, ReactionAggDTO } from '@mychat/shared';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { decryptBody, encryptBody } from '../crypto/index.js';
import { requireChannelAccess } from './channels.js';
import { reactionsForMessages } from './reactions.js';
import { filesForMessages, validateAttachments, toFileDTO } from './files.js';
import { computeRecipients, insertNotifications, publishNotifications } from './notifications.js';
import { publishEvent, subjectMsg } from '../bus.js';

const { messages, channelMembers, messageFiles } = schema;

type MessageRow = typeof messages.$inferSelect;
export type HydratedMessageRow = MessageRow;

interface DtoExtras {
  reactions?: ReactionAggDTO[] | undefined;
  files?: FileDTO[] | undefined;
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
    replyCount: row.replyCount,
    lastReplyAt: row.lastReplyAt?.toISOString() ?? null,
    reactions: extras?.reactions ?? [],
    files: extras?.files ?? [],
  };
}

/** Page hydration (phase2.md §2/§3): one grouped reactions query + one files join per page. */
async function hydrate(rows: MessageRow[]): Promise<MessageDTO[]> {
  const ids = rows.map((r) => r.id);
  const [reactions, files] = await Promise.all([reactionsForMessages(ids), filesForMessages(ids)]);
  return rows.map((r) => toMessageDTO(r, { reactions: reactions.get(r.id), files: files.get(r.id) }));
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
  const recipients = await computeRecipients(chan, userId, body, mentions ?? [], threadRootId);

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
    // notification rows in the same transaction (phase2.md §4)
    planned = await insertNotifications(tx, recipients, id, channelId);
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
  publishNotifications(planned, dto, chan.workspaceId, now.toISOString());
  return dto;
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
  return dto;
}

/** Soft delete: body overwritten with empty ciphertext (spec §2). */
export async function deleteMessage(messageId: string, userId: string): Promise<void> {
  const rows = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  const row = rows[0];
  if (!row) throw notFound('message not found');
  const { chan } = await requireChannelAccess(row.channelId, userId);
  if (row.userId !== userId) throw forbidden('only the author can delete a message');
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
