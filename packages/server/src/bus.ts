// NATS seam (phase1.md §3). Core NATS only — JetStream deferred per decision log.
// Subjects:
//   ws.{workspaceId}.chan.{channelId}.msg
//   ws.{workspaceId}.chan.{channelId}.typing
//   ws.{workspaceId}.presence
//   ws.{workspaceId}.meta
import { connect, type NatsConnection, type Subscription } from 'nats';
import type { Event } from '@mychat/shared';
import { config } from './config.js';

let nc: NatsConnection | null = null;

export async function connectBus(): Promise<NatsConnection> {
  if (!nc) {
    nc = await connect({ servers: config.natsUrl, name: 'mychat-server' });
  }
  return nc;
}

export function subjectMsg(workspaceId: string, channelId: string): string {
  return `ws.${workspaceId}.chan.${channelId}.msg`;
}
export function subjectTyping(workspaceId: string, channelId: string): string {
  return `ws.${workspaceId}.chan.${channelId}.typing`;
}
export function subjectPresence(workspaceId: string): string {
  return `ws.${workspaceId}.presence`;
}
export function subjectMeta(workspaceId: string): string {
  return `ws.${workspaceId}.meta`;
}
export function subjectWorkspaceAll(workspaceId: string): string {
  return `ws.${workspaceId}.>`;
}
/** Per-user meta subject: tells a user's live sockets about workspace joins. */
export function subjectUserMeta(userId: string): string {
  return `user.${userId}.meta`;
}

export function publishEvent(subject: string, event: Event): void {
  // Fire-and-forget: core NATS, loss-tolerant — clients backfill over REST.
  if (!nc) return; // bus optional in unit tests
  try {
    nc.publish(subject, JSON.stringify(event));
  } catch {
    /* never fail the request path on fan-out */
  }
}

export function subscribeBus(subject: string): Subscription {
  if (!nc) throw new Error('bus not connected');
  return nc.subscribe(subject);
}

export async function closeBus(): Promise<void> {
  if (nc) {
    await nc.drain().catch(() => {});
    nc = null;
  }
}
