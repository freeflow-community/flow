// The real APNs driver (#250, PUSH_APNS.md §§ "The sender seam", "Token
// lifecycle and error handling").
//
// Everything above this file is unchanged by it: the outbox worker already
// asks a `PushSender` for a `PushResult` and acts on `retryable` /
// `disableDevice`. This driver's whole job is to turn Apple's status codes and
// `reason` strings into those two booleans correctly, because that mapping is
// where a push system quietly goes wrong — a token that should have been
// disabled retries forever, and a bad key burns four attempts per notification
// while the operator sees only "delivery failed".
import { config } from '../config.js';
import { apnsCredentials, apnsProviderToken, resetApnsProviderToken } from './apnsAuth.js';
import { APNS_ORIGINS, apnsRequest, type ApnsOrigins } from './apnsClient.js';
import { apnsEnvFor, apnsTopicFor } from './target.js';
import type { ApnsHeaders, ApnsPayload, PushDevice, PushResult, PushSender } from './types.js';

/**
 * Reasons that mean "this token is dead" — the app was deleted or the token
 * rotated under it. Never retried: the row is disabled and revived by the next
 * cold start's `POST /v1/me/devices`, which clears `disabled_at`.
 *
 * 410 always means this (Apple sends `Unregistered`); the 400s are the same
 * fact discovered at parse time instead of at lookup time.
 */
const DEAD_TOKEN_REASONS = new Set(['Unregistered', 'BadDeviceToken', 'DeviceTokenNotForTopic']);

/**
 * Our bug, not Apple's and not the network's: a payload or header we built
 * wrong. Logged with the payload and dropped, because every retry would
 * rebuild the same broken request.
 */
const OUR_BUG_REASONS = new Set([
  'BadCollapseId',
  'PayloadTooLarge',
  'BadMessageId',
  'BadPriority',
  'BadTopic',
  'MissingTopic',
  'TopicDisallowed',
  'BadExpirationDate',
  'BadPushType',
  'MissingDeviceToken',
  'IdleTimeout',
]);

export interface ApnsSenderOptions {
  /** Override Apple's hosts — the tests point these at a local h2c server. */
  origins?: ApnsOrigins;
  /** Override the provider-token signer, so a test needs no `.p8`. */
  signer?: () => Promise<string>;
  /** Where the loud lines go; console by default, so a driver needs no wiring. */
  log?: { warn(o: unknown, msg: string): void; error(o: unknown, msg: string): void };
}

const consoleLog = {
  warn: (o: unknown, msg: string) => console.warn(`[push:apns] ${msg}`, o),
  error: (o: unknown, msg: string) => console.error(`[push:apns] ${msg}`, o),
};

export class ApnsHttp2PushSender implements PushSender {
  private readonly origins: ApnsOrigins;
  private readonly signer: () => Promise<string>;
  private readonly log: NonNullable<ApnsSenderOptions['log']>;

  constructor(opts: ApnsSenderOptions = {}) {
    this.origins = opts.origins ?? APNS_ORIGINS;
    this.signer = opts.signer ?? (() => apnsProviderToken());
    this.log = opts.log ?? consoleLog;
    // Fail at construction, not at the first notification: a deploy with a
    // missing key should be obvious while someone is still watching the logs.
    if (!opts.signer) apnsCredentials();
  }

  async send(device: PushDevice, payload: ApnsPayload, opts: ApnsHeaders): Promise<PushResult> {
    // The per-device column wins over FLOW_APNS_ENV (apnsEnvFor). This is what
    // lets a TestFlight build — which uses PRODUCTION APNs — and a locally
    // signed development build be live against the same server at once.
    const env = apnsEnvFor(device);
    const origin = this.origins[env];
    const topic = apnsTopicFor(device, opts);
    const body = JSON.stringify(payload);

    const headers: Record<string, string | number> = {
      authorization: `bearer ${await this.signer()}`,
      'apns-topic': topic,
      'apns-push-type': opts.pushType,
      'apns-priority': opts.priority ?? (opts.pushType === 'background' ? 5 : 10),
    };
    if (opts.expiration !== undefined) headers['apns-expiration'] = opts.expiration;
    if (opts.collapseId) headers['apns-collapse-id'] = opts.collapseId;

    let res;
    try {
      res = await apnsRequest(origin, `/3/device/${device.token}`, headers, body);
    } catch (err) {
      // Transport: a dead session, a DNS blip, a timeout. Always transient —
      // the session pool has already evicted whatever broke.
      return { ok: false, reason: `transport: ${String(err)}`, retryable: true, disableDevice: false };
    }

    if (res.status === 200) return res.apnsId ? { ok: true, apnsId: res.apnsId } : { ok: true };

    const reason = res.reason ?? res.body ?? `HTTP ${res.status}`;
    const fail = (retryable: boolean, disableDevice: boolean): PushResult => ({
      ok: false,
      status: res.status,
      reason,
      retryable,
      disableDevice,
    });

    // Dead token. The device row is disabled by the worker; nothing retries.
    if (res.status === 410 || DEAD_TOKEN_REASONS.has(reason)) return fail(false, true);

    if (res.status === 403) {
      // ExpiredProviderToken is the one 403 that isn't an alarm: our JWT aged
      // past Apple's 60-minute window (a clock skew, since we re-sign at 55).
      // Drop the cache so the retry signs a fresh one.
      if (reason === 'ExpiredProviderToken') {
        resetApnsProviderToken();
        return fail(true, false);
      }
      // InvalidProviderToken / MissingProviderToken: the key, key id or team id
      // is wrong. Every device will fail identically, so retrying is four times
      // the log noise and none of the fix. This is an operator alarm.
      this.log.error(
        { reason, keyId: config.apnsKeyId, teamId: config.apnsTeamId, topic, env },
        'APNs rejected the provider token — check FLOW_APNS_KEY / _KEY_ID / _TEAM_ID',
      );
      return fail(false, false);
    }

    // Transient: Apple is throttling us, or Apple is having a moment.
    if (res.status === 429 || res.status >= 500) return fail(true, false);

    if (OUR_BUG_REASONS.has(reason)) {
      this.log.warn({ reason, status: res.status, topic, headers: { ...headers, authorization: '<redacted>' }, payload }, 'APNs rejected a request we built wrong');
      return fail(false, false);
    }

    // Anything else 4xx: unrecognised, but a repeat of the same request would
    // be rejected the same way. Permanent, and loud enough to notice.
    this.log.warn({ reason, status: res.status, topic, env }, 'APNs returned an unhandled status');
    return fail(false, false);
  }
}
