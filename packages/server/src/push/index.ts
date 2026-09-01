// Push seam (docs/design/PUSH_APNS.md §"Server: 2. The sender seam") — mirrors
// the email seam in ../email and the blob-store seam in ../storage: one small
// interface, a dev driver, a real driver, chosen by config. The dev driver logs
// each push and drops the payload as a JSON file in .push/ — in exactly the
// format `xcrun simctl push` accepts, so the artifact that proves the payload
// builder is also the artifact that drives a simulator. No Apple account, no
// private log format.
//
// The vocabulary lives in ./types.ts and the target rules in ./target.ts, both
// re-exported here: this module is still the one import site for the rest of
// the server, but the real driver can name a device without importing the
// factory that builds it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { ApnsHttp2PushSender } from './apnsSender.js';
import { apnsEnvFor, apnsTopicFor } from './target.js';
import type { ApnsHeaders, ApnsPayload, PushDevice, PushResult, PushSender } from './types.js';

export { apnsEnvFor, apnsTopicFor };
export type { ApnsAps, ApnsHeaders, ApnsPayload, PushDevice, PushResult, PushSender } from './types.js';
export { ApnsHttp2PushSender } from './apnsSender.js';

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

let sender: PushSender | null = null;

export function pushSender(): PushSender {
  if (!sender) {
    // Constructing the APNs driver validates FLOW_APNS_KEY / _KEY_ID /
    // _TEAM_ID and throws if any is missing — deliberately not caught, so a
    // half-configured deploy is loud instead of silently falling back to
    // writing production pushes into a directory nobody reads.
    sender = config.pushDriver === 'apns' ? new ApnsHttp2PushSender() : new DevPushSender(config.pushOutboxDir);
  }
  return sender;
}

/** Tests only: inject a fake or reset the singleton. */
export function _setPushSenderForTests(s: PushSender | null): void {
  sender = s;
}
