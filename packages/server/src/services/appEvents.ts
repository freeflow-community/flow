// Events API (outgoing) — phase4.md §1 "Events API".
//
// Outbox pattern (decision log 2026-07-18 ruling 3): event rows are written in
// the SAME transaction as the triggering write into pending_app_events, then
// drained by the in-process worker below — at-least-once, survives restarts.
// Echo suppression: an app never receives events caused by its own bot user.
// Delivery only flows to apps whose event_url answered the url_verification
// challenge; sustained failure auto-clears the verification (flagged in UI).
import { createHmac, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { EMOJI_SHORTCODES, markdownToMrkdwn } from '@mychat/shared';
import { db, schema, type Tx } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { tsFromUuid } from '../slackcompat/ts.js';

const { apps, pendingAppEvents, channels } = schema;

type ChannelRow = typeof channels.$inferSelect;
type AppRow = typeof apps.$inferSelect;

const MAX_ATTEMPTS = 4; // 1 initial + 3 retries (spec: retries ×3 with backoff)
const TIMEOUT_MS = 3_000;
/** consecutive permanently-failed deliveries before delivery auto-disables */
const AUTO_DISABLE_AFTER = 5;

// ---- enqueue (same-transaction) ---------------------------------

/** Subscribed, verified, enabled apps in a workspace minus the echo app. */
async function eligibleApps(
  tx: Tx,
  workspaceId: string,
  eventType: string,
  actorUserId: string,
): Promise<AppRow[]> {
  const rows = await tx
    .select()
    .from(apps)
    .where(
      and(
        eq(apps.workspaceId, workspaceId),
        isNull(apps.disabledAt),
        sql`${apps.eventUrl} IS NOT NULL`,
        sql`${apps.eventUrlVerifiedAt} IS NOT NULL`,
        sql`${apps.eventTypes} @> ARRAY[${eventType}]::text[]`,
      ),
    );
  return rows.filter((a) => a.botUserId !== actorUserId);
}

async function enqueue(
  tx: Tx,
  workspaceId: string,
  eventType: string,
  actorUserId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const targets = await eligibleApps(tx, workspaceId, eventType, actorUserId);
  if (targets.length === 0) return;
  await tx.insert(pendingAppEvents).values(
    targets.map((a) => ({
      id: newId(),
      appId: a.id,
      eventType,
      payload,
    })),
  );
}

function channelType(chan: ChannelRow): string {
  if (chan.kind !== 'standard') return 'im';
  return chan.isPrivate ? 'group' : 'channel';
}

/** message.* / app_mention on new messages (called inside sendMessage's tx). */
export async function enqueueMessageEvents(
  tx: Tx,
  chan: ChannelRow,
  msg: { id: string; userId: string; body: string; threadRootId: string | null },
  mentionedUserIds: string[],
): Promise<void> {
  const kind = channelType(chan);
  const eventType = kind === 'im' ? 'message.im' : kind === 'group' ? 'message.groups' : 'message.channels';
  const base = {
    type: 'message',
    channel: chan.id,
    channel_type: kind,
    user: msg.userId,
    text: markdownToMrkdwn(msg.body),
    ts: tsFromUuid(msg.id),
    event_ts: tsFromUuid(msg.id),
    ...(msg.threadRootId ? { thread_ts: tsFromUuid(msg.threadRootId) } : {}),
  };
  await enqueue(tx, chan.workspaceId, eventType, msg.userId, base);
  // app_mention: only to apps whose bot user is mentioned (still echo-safe:
  // a bot mentioning itself is excluded by eligibleApps)
  if (mentionedUserIds.length > 0 || msg.body.includes('<@')) {
    const targets = await eligibleApps(tx, chan.workspaceId, 'app_mention', msg.userId);
    const mentioned = targets.filter((a) => msg.body.includes(`<@${a.botUserId}>`));
    if (mentioned.length > 0) {
      await tx.insert(pendingAppEvents).values(
        mentioned.map((a) => ({
          id: newId(),
          appId: a.id,
          eventType: 'app_mention',
          payload: { ...base, type: 'app_mention' },
        })),
      );
    }
  }
}

/** reaction_added / reaction_removed (inside the reaction transaction). */
export async function enqueueReactionEvent(
  tx: Tx,
  chan: ChannelRow,
  added: boolean,
  data: { messageId: string; userId: string; emoji: string; itemAuthorId: string },
): Promise<void> {
  const name =
    Object.entries(EMOJI_SHORTCODES).find(([, e]) => e === data.emoji)?.[0] ?? data.emoji;
  await enqueue(tx, chan.workspaceId, added ? 'reaction_added' : 'reaction_removed', data.userId, {
    type: added ? 'reaction_added' : 'reaction_removed',
    user: data.userId,
    reaction: name,
    item_user: data.itemAuthorId,
    item: { type: 'message', channel: chan.id, ts: tsFromUuid(data.messageId) },
    event_ts: tsFromUuid(newId()),
  });
}

/** member_joined_channel / member_left_channel (inside the membership write tx). */
export async function enqueueMemberEvent(
  tx: Tx,
  chan: ChannelRow,
  joined: boolean,
  userId: string,
): Promise<void> {
  await enqueue(tx, chan.workspaceId, joined ? 'member_joined_channel' : 'member_left_channel', userId, {
    type: joined ? 'member_joined_channel' : 'member_left_channel',
    user: userId,
    channel: chan.id,
    channel_type: chan.kind === 'standard' && !chan.isPrivate ? 'C' : 'G',
    team: chan.workspaceId,
    event_ts: tsFromUuid(newId()),
  });
}

/** channel_created / channel_archive (inside the channel write tx). */
export async function enqueueChannelEvent(
  tx: Tx,
  chan: ChannelRow,
  kind: 'channel_created' | 'channel_archive',
  actorUserId: string,
): Promise<void> {
  await enqueue(tx, chan.workspaceId, kind, actorUserId, {
    type: kind,
    ...(kind === 'channel_created'
      ? {
          channel: {
            id: chan.id,
            name: chan.name ?? '',
            created: Math.floor(chan.createdAt.getTime() / 1000),
            creator: chan.createdBy,
          },
        }
      : { channel: chan.id, user: actorUserId }),
    event_ts: tsFromUuid(newId()),
  });
}

// ---- url_verification challenge ---------------------------------

/**
 * Slack-style URL verification: POST {type:"url_verification", challenge} to
 * the endpoint; it must echo the challenge back (plaintext or {challenge}).
 */
export async function verifyEventUrl(url: string, signingSecret: string): Promise<boolean> {
  const challenge = randomBytes(16).toString('hex');
  const body = JSON.stringify({ token: '', challenge, type: 'url_verification' });
  try {
    const res = await postSigned(url, body, signingSecret);
    if (!res.ok) return false;
    const text = await res.text();
    if (text.trim() === challenge) return true;
    try {
      return (JSON.parse(text) as { challenge?: string }).challenge === challenge;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

function postSigned(url: string, body: string, signingSecret: string): Promise<Response> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = `v0=${createHmac('sha256', signingSecret).update(`v0:${ts}:${body}`).digest('hex')}`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': ts,
      'x-slack-signature': sig,
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

// ---- delivery worker --------------------------------------------

interface Logger {
  info(o: unknown, msg?: string): void;
  warn(o: unknown, msg?: string): void;
}

/** One drain pass. Exported for tests/QA; the interval loop calls it. */
export async function drainAppEvents(log: Logger): Promise<number> {
  const due = await db
    .select({ ev: pendingAppEvents, app: apps })
    .from(pendingAppEvents)
    .innerJoin(apps, eq(apps.id, pendingAppEvents.appId))
    .where(
      and(
        isNull(pendingAppEvents.deliveredAt),
        isNull(pendingAppEvents.failedAt),
        lte(pendingAppEvents.nextAttemptAt, new Date()),
      ),
    )
    .orderBy(pendingAppEvents.id)
    .limit(20);

  let delivered = 0;
  for (const { ev, app } of due) {
    // config may have changed since enqueue
    if (!app.eventUrl || app.eventUrlVerifiedAt === null || app.disabledAt !== null) {
      await db.update(pendingAppEvents).set({ failedAt: new Date() }).where(eq(pendingAppEvents.id, ev.id));
      continue;
    }
    const envelope = JSON.stringify({
      token: '',
      team_id: app.workspaceId,
      api_app_id: app.id,
      type: 'event_callback',
      event_id: ev.id,
      event_time: Math.floor(ev.createdAt.getTime() / 1000),
      event: ev.payload,
    });
    let ok = false;
    try {
      const res = await postSigned(app.eventUrl, envelope, app.signingSecret);
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (ok) {
      delivered += 1;
      await db.update(pendingAppEvents).set({ deliveredAt: new Date() }).where(eq(pendingAppEvents.id, ev.id));
      continue;
    }
    const attempts = ev.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await db
        .update(pendingAppEvents)
        .set({ failedAt: new Date(), attempts })
        .where(eq(pendingAppEvents.id, ev.id));
      await maybeAutoDisable(app, log);
    } else {
      // backoff: 5s, 20s, 80s
      const delayMs = 5_000 * Math.pow(4, attempts - 1);
      await db
        .update(pendingAppEvents)
        .set({ attempts, nextAttemptAt: new Date(Date.now() + delayMs) })
        .where(eq(pendingAppEvents.id, ev.id));
    }
  }
  return delivered;
}

/** Sustained failure → clear verification so delivery stops (UI shows unverified). */
async function maybeAutoDisable(app: AppRow, log: Logger): Promise<void> {
  const recent = await db
    .select({ failedAt: pendingAppEvents.failedAt })
    .from(pendingAppEvents)
    .where(eq(pendingAppEvents.appId, app.id))
    .orderBy(desc(pendingAppEvents.id))
    .limit(AUTO_DISABLE_AFTER);
  if (recent.length >= AUTO_DISABLE_AFTER && recent.every((r) => r.failedAt !== null)) {
    await db.update(apps).set({ eventUrlVerifiedAt: null }).where(eq(apps.id, app.id));
    log.warn({ appId: app.id }, 'app event delivery auto-disabled after sustained failure');
  }
}

let workerTimer: ReturnType<typeof setInterval> | null = null;

export function startAppEventsWorker(log: Logger): void {
  if (workerTimer) return;
  const tick = async () => {
    try {
      await drainAppEvents(log);
    } catch (err) {
      log.warn(err, 'app events drain failed');
    }
  };
  workerTimer = setInterval(tick, 1_000);
  workerTimer.unref();
  void tick();
}
