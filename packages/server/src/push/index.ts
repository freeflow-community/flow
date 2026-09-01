// Push seam (docs/design/PUSH_APNS.md §"Server: 2. The sender seam") — mirrors
// the email seam in ../email and the blob-store seam in ../storage: one small
// interface, a dev driver, a real driver, chosen by config. The dev driver logs
// each push and drops the payload as a JSON file in .push/ — in exactly the
// format `xcrun simctl push` accepts, so the artifact that proves the payload
// builder is also the artifact that drives a simulator. No Apple account, no
// private log format.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

/**
 * The device columns a sender actually needs. Structural on purpose: the
 * `device_tokens` row type lands with the registry (#245), and any row with
 * these fields satisfies this — so the two can merge in either order and #247
 * can pass the real row straight through.
 */
export interface PushDevice {
  /** APNs device token, hex. */
  token: string;
  /** 'ios' today (macOS later). */
  platform: string;
  /** Wins over config.apnsEnv when the row carries one (the registry's always does). */
  environment?: 'sandbox' | 'production';
  /** APNs topic this token registered under; falls back to config.apnsTopic. */
  bundleId?: string;
}

/** The reserved `aps` dictionary. Apple owns these key names — keep them verbatim. */
export interface ApnsAps {
  alert?: { title?: string; subtitle?: string; body?: string };
  sound?: string;
  badge?: number;
  /** Groups a channel's pushes in Notification Center. */
  'thread-id'?: string;
  'content-available'?: 1;
  'mutable-content'?: 1;
}

/**
 * A whole APNs payload: `aps` plus flat custom keys. What goes in those keys is
 * #248's call — this seam only moves the payload, so it stays open.
 */
export interface ApnsPayload {
  aps: ApnsAps;
  [key: string]: unknown;
}

/** APNs request headers, camelCased; a driver maps them onto `apns-*` on the wire. */
export interface ApnsHeaders {
  pushType: 'alert' | 'background';
  /** 10 = immediate (alert), 5 = power-considerate (background). */
  priority?: 10 | 5;
  /** Overrides the device's bundleId / config.apnsTopic. */
  topic?: string;
  /** Unix seconds to stop retrying; 0 means deliver once or drop. */
  expiration?: number;
  /** Same id replaces rather than stacks — channelId, for a busy channel. */
  collapseId?: string;
}

/**
 * Outcome of one send. `retryable` and `disableDevice` are the two facts the
 * outbox worker (#247) needs from APNs' status codes, so the seam names them
 * rather than making every caller re-read the table in the spec.
 */
export type PushResult =
  | { ok: true; apnsId?: string }
  | { ok: false; status?: number; reason: string; retryable: boolean; disableDevice: boolean };

export interface PushSender {
  send(device: PushDevice, payload: ApnsPayload, opts: ApnsHeaders): Promise<PushResult>;
}

/** The topic a push goes out under: the device's own registration wins. */
export function apnsTopicFor(device: PushDevice, opts?: ApnsHeaders): string {
  return opts?.topic ?? device.bundleId ?? config.apnsTopic;
}

/** Sandbox or production: the per-device column wins over the global default. */
export function apnsEnvFor(device: PushDevice): 'sandbox' | 'production' {
  return device.environment ?? config.apnsEnv;
}

/**
 * Writes each push to `.push/<stamp>-<token prefix>.json` and logs it.
 *
 * The file is the APNs payload plus one key: `Simulator Target Bundle`, which
 * is how `xcrun simctl push <device> <file>` learns which app to deliver to.
 * That single addition is what makes the artifact runnable as-is —
 * `xcrun simctl push booted .push/<file>` — instead of needing a wrapper.
 * simctl strips the key before delivery; the app sees exactly `aps` and the
 * custom keys.
 */
export class DevPushSender implements PushSender {
  constructor(private readonly dir: string) {}

  async send(device: PushDevice, payload: ApnsPayload, opts: ApnsHeaders): Promise<PushResult> {
    await fs.mkdir(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = device.token.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'notoken';
    const file = path.join(this.dir, `${stamp}-${slug}.json`);
    const topic = apnsTopicFor(device, opts);
    await fs.writeFile(file, `${JSON.stringify({ ...payload, 'Simulator Target Bundle': topic }, null, 2)}\n`);
    const title = payload.aps.alert?.title ?? '';
    console.log(
      `[push:dev] token=${slug}… env=${apnsEnvFor(device)} topic=${topic} type=${opts.pushType}` +
        `${title ? ` title="${title}"` : ''} (${file})`,
    );
    return { ok: true };
  }
}

/**
 * Real APNs over HTTP/2 is #250. Registered here so the config switch is
 * complete and the missing piece fails loudly rather than silently falling
 * back to the dev driver in production.
 */
export class ApnsPushSender implements PushSender {
  async send(): Promise<PushResult> {
    throw new Error('FLOW_PUSH_DRIVER=apns is not implemented yet, see #250');
  }
}

let sender: PushSender | null = null;

export function pushSender(): PushSender {
  if (!sender) {
    if (config.pushDriver === 'apns') {
      sender = new ApnsPushSender();
    } else {
      sender = new DevPushSender(config.pushOutboxDir);
    }
  }
  return sender;
}

/** Tests only: inject a fake or reset the singleton. */
export function _setPushSenderForTests(s: PushSender | null): void {
  sender = s;
}
