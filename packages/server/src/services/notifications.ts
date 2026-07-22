// Mentions + notifications (phase2.md §4, plus operator ruling adding group
// mentions — decision log 2026-07-18; phase 10 adds per-user alert prefs,
// status suppression, and the mention subkind).
//
// Notification rows are written in the same transaction as the message; events
// are published after commit on the per-user subject user.{userId}.notify
// (approved deviation from the workspace-scoped subject in the spec).
//
// Kinds: 0=mention (user or group mention), 1=dm, 2=thread_reply,
// 3=channel activity (notify_level=all). Precedence when a message qualifies a
// user several ways: dm > mention > thread_reply > activity — one row per
// (user, message). notify_level 0 (mute) suppresses everything, including DMs.
//
// Phase 10: rows are ALWAYS written — per-user prefs and status suppression
// only gate OS *alerts* (suppressAlert on the DTO), never the inbox.
import { and, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  GROUP_MENTION_RE,
  type NotificationDTO,
  type NotificationKind,
  type NotificationPage,
  type NotificationPrefs,
  type NotificationSubkind,
} from '@flow/shared';
import { db, schema, type Tx } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest } from '../lib/errors.js';
import { publishEvent, subjectUserNotify } from '../bus.js';
import { isOnline } from '../presence.js';
import { toMessageDTO, type HydratedMessageRow } from './messages.js';

const { notifications, channelMembers, workspaceMembers, messages, channels, users } = schema;

type ChannelRow = typeof channels.$inferSelect;

export interface PlannedNotification {
  id: string;
  userId: string;
  kind: NotificationKind;
  subkind: NotificationSubkind | null;
}

interface RecipientPlan {
  kind: NotificationKind;
  subkind: NotificationSubkind | null;
}

/** Prefs + status flag feeding the suppressAlert computation, per recipient. */
export interface AlertContext {
  prefs: NotificationPrefs;
  statusSuppressAlerts: boolean;
}

/**
 * The alert gate (phase 10). Rows exist regardless — this decides OS banners.
 * kind 3 (channel activity) never alerts; a suppressing status wins over
 * everything; legacy null subkind reads as a direct mention.
 */
export function suppressAlertFor(
  kind: NotificationKind,
  subkind: NotificationSubkind | null,
  ctx: AlertContext,
): boolean {
  if (kind === 3) return true;
  if (ctx.statusSuppressAlerts) return true;
  const key =
    kind === 1
      ? 'dm'
      : kind === 2
        ? 'threadReply'
        : subkind === 'here' || subkind === 'channel'
          ? 'groupMention'
          : 'mention';
  return ctx.prefs[key] === false;
}

/**
 * Decide who gets notified for a new message. Pure planning — no writes.
 * Also returns each recipient's alert context (prefs + status flag) so the
 * post-commit fan-out can compute suppressAlert without a second query.
 * @param mentions resolved user ids from the client (spec: server only validates
 *   workspace membership — no fuzzy name matching). Throws 400 on ids that are
 *   not workspace members; silently skips users who cannot see the channel.
 */
export async function computeRecipients(
  chan: ChannelRow,
  senderId: string,
  body: string,
  mentions: string[],
  threadRootId?: string,
): Promise<{ recipients: Map<string, RecipientPlan>; alertContext: Map<string, AlertContext> }> {
  // channel membership + notify levels in one query
  const memberRows = await db
    .select({ userId: channelMembers.userId, notifyLevel: channelMembers.notifyLevel })
    .from(channelMembers)
    .where(eq(channelMembers.channelId, chan.id));
  const memberLevel = new Map(memberRows.map((r) => [r.userId, r.notifyLevel]));

  const muted = (uid: string): boolean => memberLevel.get(uid) === 0;
  // priority: lower number wins (dm strongest)
  const PRIORITY: Record<NotificationKind, number> = { 1: 0, 0: 1, 2: 2, 3: 3 };
  const out = new Map<string, RecipientPlan>();
  const propose = (uid: string, kind: NotificationKind, subkind: NotificationSubkind | null = null): void => {
    if (uid === senderId || muted(uid)) return;
    const cur = out.get(uid);
    // direct mention beats a group mention for the same user in the same message
    if (cur === undefined || PRIORITY[kind] < PRIORITY[cur.kind]) out.set(uid, { kind, subkind });
  };

  if (chan.kind !== 'standard') {
    // any DM message notifies every other member (kind 1)
    for (const [uid] of memberLevel) propose(uid, 1);
    return finish(out);
  }

  // user mentions: validate workspace membership (400 on strangers)
  const uniqueMentions = [...new Set(mentions)];
  if (uniqueMentions.length > 0) {
    const wsRows = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, chan.workspaceId), inArray(workspaceMembers.userId, uniqueMentions)));
    const wsSet = new Set(wsRows.map((r) => r.userId));
    for (const uid of uniqueMentions) {
      if (!wsSet.has(uid)) throw badRequest('bad_mention', `mentioned user ${uid} is not a workspace member`);
      // private channels: only members can be notified (no membership leak)
      if (chan.isPrivate && !memberLevel.has(uid)) continue;
      propose(uid, 0, 'mention');
    }
  }

  // group mentions (operator ruling): <!channel>/<!everyone> → all channel
  // members; <!here> → currently-online channel members (single-node presence)
  const groupTokens = new Set([...body.matchAll(GROUP_MENTION_RE)].map((m) => m[1]));
  if (groupTokens.has('channel') || groupTokens.has('everyone')) {
    for (const [uid] of memberLevel) propose(uid, 0, 'channel');
  } else if (groupTokens.has('here')) {
    for (const [uid] of memberLevel) if (isOnline(uid)) propose(uid, 0, 'here');
  }

  // thread replies notify prior participants (root author + repliers) who are
  // still channel members
  if (threadRootId) {
    const participants = await db
      .select({ userId: messages.userId })
      .from(messages)
      .where(
        and(
          sql`(${messages.id} = ${threadRootId} OR ${messages.threadRootId} = ${threadRootId})`,
          isNull(messages.deletedAt),
        ),
      )
      .groupBy(messages.userId);
    for (const p of participants) {
      if (memberLevel.has(p.userId)) propose(p.userId, 2);
    }
  }

  // notify_level=all: every message in the channel
  for (const [uid, level] of memberLevel) {
    if (level === 2) propose(uid, 3);
  }

  return finish(out);
}

/** Load each recipient's alert context (prefs + status flag) in one query. */
async function finish(out: Map<string, RecipientPlan>): Promise<{
  recipients: Map<string, RecipientPlan>;
  alertContext: Map<string, AlertContext>;
}> {
  const ids = [...out.keys()];
  const rows = ids.length
    ? await db
        .select({ id: users.id, prefs: users.notificationPrefs, suppress: users.statusSuppressAlerts })
        .from(users)
        .where(inArray(users.id, ids))
    : [];
  const alertContext = new Map<string, AlertContext>(
    rows.map((r) => [r.id, { prefs: r.prefs, statusSuppressAlerts: r.suppress }]),
  );
  return { recipients: out, alertContext };
}

/** Insert planned rows inside the message's transaction (phase2.md §4). */
export async function insertNotifications(
  tx: Tx,
  recipients: Map<string, RecipientPlan>,
  messageId: string,
  channelId: string,
): Promise<PlannedNotification[]> {
  const planned: PlannedNotification[] = [...recipients].map(([userId, p]) => ({ id: newId(), userId, ...p }));
  if (planned.length > 0) {
    await tx
      .insert(notifications)
      .values(planned.map((p) => ({ id: p.id, userId: p.userId, messageId, channelId, kind: p.kind, subkind: p.subkind })));
  }
  return planned;
}

/** Post-commit fan-out on the per-user notify subject. */
export function publishNotifications(
  planned: PlannedNotification[],
  alertContext: Map<string, AlertContext>,
  message: import('@flow/shared').MessageDTO,
  workspaceId: string,
  ts: string,
): void {
  for (const p of planned) {
    const ctx = alertContext.get(p.userId) ?? { prefs: {}, statusSuppressAlerts: false };
    const dto: NotificationDTO = {
      id: p.id,
      userId: p.userId,
      messageId: message.id,
      channelId: message.channelId,
      workspaceId,
      kind: p.kind,
      subkind: p.subkind,
      suppressAlert: suppressAlertFor(p.kind, p.subkind, ctx),
      createdAt: ts,
      readAt: null,
      message,
    };
    publishEvent(subjectUserNotify(p.userId), {
      type: 'notification.created',
      workspaceId,
      channelId: message.channelId,
      ts,
      data: dto,
    });
  }
}

/**
 * GET /v1/me/notifications — newest first, cursor on id. The embedded message
 * preview carries the decrypted body but empty reactions/files (list rendering
 * doesn't need them; the channel view hydrates fully).
 */
export async function listNotifications(
  userId: string,
  before: string | undefined,
  limit: number,
): Promise<NotificationPage> {
  const conds = [eq(notifications.userId, userId)];
  if (before) conds.push(sql`${notifications.id} < ${before}`);
  const me = (await db.select({ prefs: users.notificationPrefs, suppress: users.statusSuppressAlerts }).from(users).where(eq(users.id, userId)).limit(1))[0];
  const ctx: AlertContext = { prefs: me?.prefs ?? {}, statusSuppressAlerts: me?.suppress ?? false };
  const rows = await db
    .select({ n: notifications, m: messages, workspaceId: channels.workspaceId })
    .from(notifications)
    .innerJoin(messages, eq(messages.id, notifications.messageId))
    .innerJoin(channels, eq(channels.id, notifications.channelId))
    .where(and(...conds))
    .orderBy(desc(notifications.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const unread = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return {
    notifications: rows.slice(0, limit).map((r) => {
      const kind = r.n.kind as NotificationKind;
      const subkind = r.n.subkind as NotificationSubkind | null;
      return {
        id: r.n.id,
        userId: r.n.userId,
        messageId: r.n.messageId,
        channelId: r.n.channelId,
        workspaceId: r.workspaceId,
        kind,
        subkind,
        suppressAlert: suppressAlertFor(kind, subkind, ctx),
        createdAt: r.n.createdAt.toISOString(),
        readAt: r.n.readAt?.toISOString() ?? null,
        message: toMessageDTO(r.m as HydratedMessageRow),
      };
    }),
    hasMore,
    unreadCount: unread[0]?.n ?? 0,
  };
}

/** POST /v1/me/notifications/read {upToId} — mark everything up to the cursor read. */
export async function markNotificationsRead(userId: string, upToId: string): Promise<number> {
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), lte(notifications.id, upToId)))
    .returning({ id: notifications.id });
  return updated.length;
}
