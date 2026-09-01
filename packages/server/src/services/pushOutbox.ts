// APNs delivery outbox (#247, PUSH_APNS.md § "Delivery: outbox, not
// fire-and-forget").
//
// Outbox pattern, same as the Events API (decision log 2026-07-18 ruling 3):
// pending_push rows are written in the SAME transaction as the notification
// row, then drained by the in-process worker below — at-least-once, surviving
// restarts. WS publish can afford to drop, because a client that reconnects
// backfills over REST; a phone with no socket has nothing to backfill from, so
// a dropped push is a notification the user never learns about.
//
// `services/appEvents.ts` is the model, deliberately down to the constants:
// MAX_ATTEMPTS, the 5s/20s/80s backoff, the FOR UPDATE SKIP LOCKED claim with a
// lease, and the auto-disable-on-sustained-failure behaviour.
//
// ONE ROW PER NOTIFICATION, not per device. The fan-out to a user's devices
// happens here, at send time: devices change between commit and delivery, and
// the badge count is computed once per notification instead of once per phone.
import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { db, schema, type Tx } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { pushSender, type ApnsHeaders, type ApnsPayload, type PushDevice } from '../push/index.js';
import { unreadCount } from './notifications.js';

const { channels, deviceTokens, messages, notifications, pendingPush } = schema;

/** 1 initial + 3 retries, same as the Events API outbox. */
const MAX_ATTEMPTS = 4;
/** Consecutive permanently-failed pushes for one user before their devices are
 * disabled — the appEvents `AUTO_DISABLE_AFTER` analogue. */
const AUTO_DISABLE_AFTER = 5;
/** Rows claimed per drain pass. */
const BATCH = 20;
/** How long a claimed row is invisible to other drains. A batch's sends finish
 * well inside this; the lease only matters when a replica dies mid-batch, and
 * then its rows retry this soon with no attempts consumed. */
const CLAIM_LEASE_MS = 120_000;
/** APNs stops retrying after this. A two-hour-old alert is noise, not news. */
const EXPIRATION_S = 3_600;

// ---- enqueue (same-transaction) ---------------------------------

/** A notification that wants a push: whose it is, and which row it came from. */
export interface PushIntent {
  userId: string;
  notificationId: string;
}

/**
 * Enqueue pushes inside the notification's own transaction.
 *
 * Users with no live device are skipped here — the `eligibleApps` move from
 * appEvents, and the reason is the same: an outbox row nobody can receive is
 * pure write amplification. This is an eligibility check, not the fan-out: the
 * *devices* are still resolved at send time, so a phone registered between
 * commit and delivery still gets the push.
 */
export async function enqueuePendingPush(tx: Tx, intents: PushIntent[]): Promise<void> {
  if (intents.length === 0) return;
  const userIds = [...new Set(intents.map((i) => i.userId))];
  const live = await tx
    .selectDistinct({ userId: deviceTokens.userId })
    .from(deviceTokens)
    .where(and(inArray(deviceTokens.userId, userIds), isNull(deviceTokens.disabledAt)));
  const hasDevice = new Set(live.map((r) => r.userId));
  const rows = intents.filter((i) => hasDevice.has(i.userId));
  if (rows.length === 0) return;
  await tx.insert(pendingPush).values(
    rows.map((i) => ({ id: newId(), userId: i.userId, notificationId: i.notificationId })),
  );
}

// ---- payload seam (#248 owns the contents) -----------------------

/** What the outbox knows about a notification when it comes time to send. */
interface PushContext {
  notificationId: string;
  workspaceId: string;
  channelId: string;
  messageId: string;
  threadRootId: string | null;
  kind: number;
}

/**
 * The payload, minus its words.
 *
 * #248 owns the alert strings and what the badge means; this builds the part
 * the outbox is actually the authority on — the routing keys (identical to the
 * `userInfo` the macOS banner already carries, so tap-routing reuses
 * `AppState.openNotification`) and the badge value it computed once for this
 * notification. Until #248 lands there is no `alert` dictionary, which makes
 * this a badge-and-routing push rather than a banner with an empty title.
 */
export function buildPushPayload(ctx: PushContext, badge: number): ApnsPayload {
  return {
    aps: {
      sound: 'default',
      badge,
      'thread-id': ctx.channelId, // groups a channel's pushes in Notification Center
    },
    workspaceId: ctx.workspaceId,
    channelId: ctx.channelId,
    messageId: ctx.messageId,
    ...(ctx.threadRootId ? { threadRootId: ctx.threadRootId } : {}),
    notificationId: ctx.notificationId, // lets the tap mark exactly this row read
  };
}

/** Headers per PUSH_APNS.md § "The payload". Kind 3 (channel activity) collapses
 * on the channel, so a busy channel replaces rather than stacks. */
export function pushHeadersFor(ctx: PushContext): ApnsHeaders {
  return {
    pushType: 'alert',
    priority: 10,
    expiration: Math.floor(Date.now() / 1000) + EXPIRATION_S,
    ...(ctx.kind === 3 ? { collapseId: ctx.channelId } : {}),
  };
}

// ---- delivery worker --------------------------------------------

interface Logger {
  info(o: unknown, msg?: string): void;
  warn(o: unknown, msg?: string): void;
}

/**
 * One drain pass. Exported for tests/QA; the interval loop calls it. Returns
 * the number of rows resolved as delivered.
 *
 * Rows are claimed with `FOR UPDATE SKIP LOCKED` in a short transaction that
 * pushes `nextAttemptAt` forward as a lease, so two replicas draining is
 * throughput rather than double delivery. Sending happens outside that
 * transaction; the success/backoff writes below overwrite the lease.
 */
export async function drainPendingPush(log: Logger): Promise<number> {
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(pendingPush)
      .where(
        and(
          isNull(pendingPush.deliveredAt),
          isNull(pendingPush.failedAt),
          lte(pendingPush.nextAttemptAt, new Date()),
        ),
      )
      .orderBy(pendingPush.id)
      .limit(BATCH)
      .for('update', { skipLocked: true });
    if (rows.length > 0) {
      await tx
        .update(pendingPush)
        .set({ nextAttemptAt: new Date(Date.now() + CLAIM_LEASE_MS) })
        .where(
          inArray(
            pendingPush.id,
            rows.map((r) => r.id),
          ),
        );
    }
    return rows;
  });
  if (claimed.length === 0) return 0;

  // Notification context and devices are both read HERE, not at enqueue: this
  // is the send-time fan-out the one-row-per-notification shape exists for.
  const ctxRows = await db
    .select({
      notificationId: notifications.id,
      workspaceId: channels.workspaceId,
      channelId: notifications.channelId,
      messageId: notifications.messageId,
      threadRootId: messages.threadRootId,
      kind: notifications.kind,
    })
    .from(notifications)
    .innerJoin(messages, eq(messages.id, notifications.messageId))
    .innerJoin(channels, eq(channels.id, notifications.channelId))
    .where(inArray(notifications.id, [...new Set(claimed.map((r) => r.notificationId))]));
  const ctxById = new Map(ctxRows.map((r) => [r.notificationId, r]));

  const deviceRows = await db
    .select()
    .from(deviceTokens)
    .where(
      and(
        inArray(deviceTokens.userId, [...new Set(claimed.map((r) => r.userId))]),
        isNull(deviceTokens.disabledAt),
      ),
    );
  const devicesByUser = new Map<string, (typeof deviceRows)[number][]>();
  for (const d of deviceRows) devicesByUser.set(d.userId, [...(devicesByUser.get(d.userId) ?? []), d]);

  const sender = pushSender();
  let delivered = 0;
  for (const row of claimed) {
    const ctx = ctxById.get(row.notificationId);
    if (!ctx) {
      // The notification went away between claim and read (a hard-deleted
      // message cascades). Nothing to push, and no retry would find it.
      await resolve(row.id, { failed: false });
      continue;
    }
    const devices = devicesByUser.get(row.userId) ?? [];
    if (devices.length === 0) {
      // Every device unregistered since enqueue. Nothing owed, so the row is
      // done — a retry would find the same nothing.
      await resolve(row.id, { failed: false });
      delivered += 1;
      continue;
    }

    // Once per notification — the whole point of not having a row per device.
    const badge = await unreadCount(row.userId);
    const payload = buildPushPayload(ctx, badge);
    const headers = pushHeadersFor(ctx);

    let anyOk = false;
    let anyRetryable = false;
    for (const device of devices) {
      const result = await send(sender, device, payload, headers);
      if (result.ok) {
        anyOk = true;
        continue;
      }
      if (result.disableDevice) {
        // APNs 410 / BadDeviceToken: the app is gone or the token rotated.
        // Kept, not deleted — the next cold start's register revives the row.
        await db
          .update(deviceTokens)
          .set({ disabledAt: new Date() })
          .where(eq(deviceTokens.id, device.id));
        log.info({ deviceId: device.id, reason: result.reason }, 'push device disabled by APNs');
      } else if (result.retryable) {
        anyRetryable = true;
      } else {
        log.warn({ notificationId: row.notificationId, reason: result.reason }, 'push permanently rejected');
      }
    }

    if (anyOk) {
      // At-least-once is per notification, not per device: one phone that took
      // it is enough, and retrying the row would re-deliver to that phone.
      delivered += 1;
      await resolve(row.id, { failed: false });
      continue;
    }
    const attempts = row.attempts + 1;
    if (anyRetryable && attempts < MAX_ATTEMPTS) {
      const delayMs = 5_000 * Math.pow(4, attempts - 1); // 5s, 20s, 80s
      await db
        .update(pendingPush)
        .set({ attempts, nextAttemptAt: new Date(Date.now() + delayMs) })
        .where(eq(pendingPush.id, row.id));
      continue;
    }
    await db
      .update(pendingPush)
      .set({ failedAt: new Date(), attempts })
      .where(eq(pendingPush.id, row.id));
    await maybeAutoDisable(row.userId, log);
  }
  return delivered;
}

/** Mark a claimed row resolved — the lease it holds is overwritten either way.
 *
 * The two nothing-to-do cases above resolve as *delivered*, where appEvents
 * uses `failedAt` for its equivalent (a deleted app row). Deliberate: the
 * sustained-failure streak below is keyed on the user, so counting "this user's
 * message was deleted" as a failure would eventually silence a phone that
 * nothing is actually wrong with. appEvents keys its streak on the app whose
 * endpoint is the thing being judged, so it has no such confusion to avoid. */
async function resolve(id: string, opts: { failed: boolean }): Promise<void> {
  await db
    .update(pendingPush)
    .set(opts.failed ? { failedAt: new Date() } : { deliveredAt: new Date() })
    .where(eq(pendingPush.id, id));
}

/** A driver that throws is a transient outage, not a rejected push. */
async function send(
  sender: ReturnType<typeof pushSender>,
  device: PushDevice,
  payload: ApnsPayload,
  headers: ApnsHeaders,
): Promise<{ ok: true } | { ok: false; reason: string; retryable: boolean; disableDevice: boolean }> {
  try {
    const r = await sender.send(device, payload, headers);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason, retryable: r.retryable, disableDevice: r.disableDevice };
  } catch (err) {
    return { ok: false, reason: String(err), retryable: true, disableDevice: false };
  }
}

/**
 * Sustained failure → stop pushing to this user's devices (the appEvents
 * auto-disable analogue, where it clears `eventUrlVerifiedAt`).
 *
 * Unlike an app endpoint this is self-healing and needs no operator: the iOS
 * client re-registers on every cold start and `registerDevice` clears
 * `disabled_at`, so the phone that comes back gets pushes again.
 */
async function maybeAutoDisable(userId: string, log: Logger): Promise<void> {
  const recent = await db
    .select({ failedAt: pendingPush.failedAt })
    .from(pendingPush)
    .where(eq(pendingPush.userId, userId))
    .orderBy(desc(pendingPush.id))
    .limit(AUTO_DISABLE_AFTER);
  if (recent.length < AUTO_DISABLE_AFTER || !recent.every((r) => r.failedAt !== null)) return;
  const disabled = await db
    .update(deviceTokens)
    .set({ disabledAt: new Date() })
    .where(and(eq(deviceTokens.userId, userId), isNull(deviceTokens.disabledAt)))
    .returning({ id: deviceTokens.id });
  if (disabled.length > 0) {
    log.warn({ userId, devices: disabled.length }, 'push delivery auto-disabled after sustained failure');
  }
}

let workerTimer: ReturnType<typeof setInterval> | null = null;

export function startPushWorker(log: Logger): void {
  if (workerTimer) return;
  const tick = async () => {
    try {
      await drainPendingPush(log);
    } catch (err) {
      log.warn(err, 'push outbox drain failed');
    }
  };
  workerTimer = setInterval(tick, 1_000);
  workerTimer.unref();
  void tick();
}

/** Tests only: let a suite stop the interval it started. */
export function _stopPushWorkerForTests(): void {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}
