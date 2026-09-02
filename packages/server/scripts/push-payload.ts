#!/usr/bin/env -S node --import tsx
// Prints a real APNs payload for a given event type, ready for `simctl push`.
//
// Deliberately *not* a second payload builder: it calls `buildPushPayload` /
// `buildBadgeSyncPayload` from src/push/payload.ts, the same pure functions the
// outbox drain calls. A hand-rolled fixture drifts from the drain silently, and
// then a push test is testing the fixture. The only key added on top is
// `Simulator Target Bundle`, which is how `xcrun simctl push` learns which app
// to deliver to (simctl strips it before delivery).
//
// Usually driven by scripts/push-sim.sh; standalone it is just:
//   node --import tsx scripts/push-payload.ts --event dm
import { randomUUID } from 'node:crypto';
import {
  buildBadgeSyncPayload,
  buildPushPayload,
  type ChannelKind,
  type PushContext,
} from '../src/push/payload.js';
import type { NotificationKind } from '@flow/shared';

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] !== undefined) return args[i + 1]!;
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : fallback;
};

/** The event types a push test actually wants, mapped onto notifications.kind. */
const EVENTS: Record<
  string,
  { kind: NotificationKind; channelKind: ChannelKind; thread?: boolean; emoji?: string; solo?: boolean }
> = {
  message: { kind: 3, channelKind: 'standard' }, // channel activity (notify_level=all)
  mention: { kind: 0, channelKind: 'standard' },
  dm: { kind: 1, channelKind: 'dm', solo: true },
  'group-dm': { kind: 1, channelKind: 'group_dm' },
  thread: { kind: 2, channelKind: 'standard', thread: true },
  reaction: { kind: 4, channelKind: 'standard', emoji: '👍' },
  added: { kind: 5, channelKind: 'standard' },
  badge: { kind: 3, channelKind: 'standard' }, // silent; kind is unused below
};

const event = flag('event', 'message')!;
const spec = EVENTS[event];
if (!spec) {
  console.error(`push-payload: unknown --event ${event} (have: ${Object.keys(EVENTS).join(', ')})`);
  process.exit(2);
}

const bundle = flag('bundle', 'im.freeflow.app')!;
const badge = Number(flag('badge', '1'));

if (event === 'badge') {
  // The silent badge-sync push: no alert, no sound, just the count.
  console.log(
    JSON.stringify({ ...buildBadgeSyncPayload(badge), 'Simulator Target Bundle': bundle }, null, 2),
  );
  process.exit(0);
}

const ctx: PushContext = {
  notificationId: flag('notification', randomUUID())!,
  workspaceId: flag('workspace', randomUUID())!,
  channelId: flag('channel', randomUUID())!,
  messageId: flag('message', randomUUID())!,
  threadRootId: spec.thread ? flag('thread-root', randomUUID())! : null,
  kind: spec.kind,
  actorName: flag('actor', 'Bob')!,
  reactionEmoji: flag('emoji') ?? spec.emoji ?? null,
  body: flag('body', 'lunch at 1?')!,
  names: {},
  conversationName: flag('conversation', spec.channelKind === 'standard' ? 'general' : 'Bob')!,
  channelKind: spec.channelKind,
  soloDmWithActor: spec.solo === true,
};

console.log(
  JSON.stringify(
    { ...buildPushPayload(ctx, badge), 'Simulator Target Bundle': bundle },
    null,
    2,
  ),
);
