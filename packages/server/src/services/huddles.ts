// Voice huddle (Phase 1): authorization, LiveKit token minting, fan-out, and
// the webhook/boot reconciliation that keeps ../huddles.ts in sync with
// LiveKit (the source of truth — see that module's doc comment and
// decision_log.md 2026-08-20).
import { AccessToken, RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';
import { TrackSource } from '@livekit/protocol';
import { eq } from 'drizzle-orm';
import type { Event, HuddleUpdatedData } from '@flow/shared';
import { db, schema } from '../db/index.js';
import { publishEvent, subjectHuddle, subjectHuddleAll, subscribeBus } from '../bus.js';
import { config } from '../config.js';
import { ApiError, badRequest } from '../lib/errors.js';
import * as store from '../huddles.js';
import { toParticipantDTOs, type HuddleParticipant } from '../huddles.js';
import { requireChannelAccess } from './channels.js';

const { channels } = schema;

function requireLiveKitConfigured(): { apiKey: string; apiSecret: string; url: string } {
  const { livekitApiKey: apiKey, livekitApiSecret: apiSecret, livekitUrl: url } = config;
  if (!apiKey || !apiSecret || !url) throw new ApiError(503, 'huddles_unavailable', 'voice huddles are not configured');
  return { apiKey, apiSecret, url };
}

function rosterChanged(before: HuddleParticipant[], after: HuddleParticipant[]): boolean {
  if (before.length !== after.length) return true;
  const beforeIds = new Set(before.map((p) => p.userId));
  return after.some((p) => !beforeIds.has(p.userId));
}

function publish(channelId: string, workspaceId: string, participants: HuddleParticipant[]): void {
  const data: HuddleUpdatedData = { channelId, participants: toParticipantDTOs(participants) };
  publishEvent(subjectHuddle(workspaceId, channelId), {
    type: 'huddle.updated',
    workspaceId,
    channelId,
    ts: new Date().toISOString(),
    data,
  });
}

/** Channels only (standard, not DM/group DM), and not archived (spec: huddles
 * are scoped to exactly one channel — see CONTEXT.md). */
async function requireHuddleEligible(channelId: string, userId: string) {
  const { chan, isMember } = await requireChannelAccess(channelId, userId);
  if (chan.kind !== 'standard') throw badRequest('dm_channel', 'huddles are not available in DMs');
  if (chan.archivedAt) throw badRequest('channel_archived', 'channel is archived');
  return { chan, isMember };
}

/**
 * Join a channel's huddle: mints a LiveKit access token scoped to that room
 * (room name = channel id) and records the join. Idempotent — calling this
 * while already an active participant re-mints a fresh token rather than
 * erroring (decision log 2026-08-20); this is also the reconnect path.
 * Audio-only is enforced here, server-side, not just in client UI:
 * `canPublishSources` is restricted to the microphone.
 */
export async function joinHuddle(channelId: string, userId: string): Promise<{ token: string; url: string }> {
  const { apiKey, apiSecret, url } = requireLiveKitConfigured();
  const { chan } = await requireHuddleEligible(channelId, userId);

  const { before, after } = store.joinHuddle(channelId, chan.workspaceId, userId);
  if (rosterChanged(before, after)) publish(channelId, chan.workspaceId, after);

  const at = new AccessToken(apiKey, apiSecret, { identity: userId, ttl: config.livekitTokenTtl });
  at.addGrant({
    room: channelId,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: true,
  });
  return { token: await at.toJwt(), url };
}

/** Leave a channel's huddle. Idempotent (no-op if the caller wasn't in it). */
export async function leaveHuddle(channelId: string, userId: string): Promise<void> {
  const { chan } = await requireChannelAccess(channelId, userId);
  const { before, after } = store.leaveHuddle(channelId, userId);
  if (rosterChanged(before, after)) publish(channelId, chan.workspaceId, after);
}

/**
 * LiveKit webhook — the reconciliation safety net for a participant/room that
 * vanished without a REST leave call (network drop, tab killed, crash).
 * Signature-verified via `WebhookReceiver`; not a Flow user, so no requireAuth.
 */
export async function handleLiveKitWebhook(rawBody: string, authHeader: string): Promise<void> {
  const { apiKey, apiSecret } = requireLiveKitConfigured();
  const receiver = new WebhookReceiver(apiKey, apiSecret);
  const event = await receiver.receive(rawBody, authHeader);

  if (event.event === 'participant_left') {
    const channelId = event.room?.name;
    const userId = event.participant?.identity;
    if (!channelId || !userId) return;
    const { before, after, workspaceId } = store.leaveHuddle(channelId, userId);
    if (workspaceId && rosterChanged(before, after)) publish(channelId, workspaceId, after);
  } else if (event.event === 'room_finished') {
    const channelId = event.room?.name;
    if (!channelId) return;
    const { before, workspaceId } = store.clearChannelHuddle(channelId);
    if (workspaceId && before.length > 0) publish(channelId, workspaceId, []);
  }
}

/**
 * Boot-time reconciliation (decision log 2026-08-20): a server restart wipes
 * ../huddles.ts's in-memory map while LiveKit's rooms — hosted separately on
 * LiveKit Cloud — keep running with real participants. Rebuild the cache from
 * LiveKit's own REST API and republish corrected rosters so already-connected
 * clients stop showing a stale huddle state from before the restart.
 */
export async function reconcileHuddlesFromLiveKit(): Promise<void> {
  if (!config.livekitEnabled) return;
  const { livekitApiKey: apiKey, livekitApiSecret: apiSecret, livekitUrl: url } = config;
  const svc = new RoomServiceClient(url!, apiKey, apiSecret);
  const rooms = await svc.listRooms();

  for (const room of rooms) {
    const channelId = room.name;
    const chanRows = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
    const chan = chanRows[0];
    if (!chan) continue; // stale/foreign room name — not one of ours

    const participants = await svc.listParticipants(channelId);
    const mapped: HuddleParticipant[] = participants.map((p) => ({
      userId: p.identity,
      joinedAt: Number(p.joinedAtMs),
    }));
    const { before, after } = store.reconcileChannel(channelId, chan.workspaceId, mapped);
    if (rosterChanged(before, after)) publish(channelId, chan.workspaceId, after);
  }
}

/**
 * Replica roster sync (phase 18 M2, design doc §1a): join/leave REST calls
 * and LiveKit webhooks land on one replica, so the others' caches go stale.
 * Every `huddle.updated` event carries the channel's *full* roster, so each
 * replica applies every event — its own included — to converge. Applying our
 * own loopback is idempotent; ordering per subject is NATS-guaranteed, so the
 * worst case is a milliseconds-stale roster between a local write and the
 * loopback of the event before it. Boot reconciliation against LiveKit covers
 * anything a fire-and-forget event loses.
 */
export function startHuddleRosterSync(): { stop(): void } {
  const sub = subscribeBus(subjectHuddleAll());
  void (async () => {
    for await (const m of sub) {
      try {
        const event = JSON.parse(new TextDecoder().decode(m.data)) as Event;
        if (event.type !== 'huddle.updated' || !event.channelId) continue;
        const data = event.data as HuddleUpdatedData;
        store.reconcileChannel(
          event.channelId,
          event.workspaceId,
          data.participants.map((p) => ({ userId: p.userId, joinedAt: Date.parse(p.joinedAt) })),
        );
      } catch {
        /* skip malformed */
      }
    }
  })();
  return {
    stop() {
      sub.unsubscribe();
    },
  };
}
