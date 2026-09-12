import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from '@flow/shared';
import type { ConnectionRuntime } from '../connectionRuntime';
import { SlackBackend, shortcodeFor, slackCapabilities } from './slackBackend';

/** A runtime stand-in: the backend only reads origin, token, identity and
 * disposal from it. */
function runtime(over: Partial<ConnectionRuntime> = {}): ConnectionRuntime {
  return { connectionId: 'conn-1', provider: 'slack', origin: 'https://connector.test', label: 'Acme · alice', userId: 'U1', isDisposed: false, getToken: () => 'cred-1', ...over } as unknown as ConnectionRuntime;
}
const connection = { providerIdentity: JSON.stringify(['slack', null, 'T1', 'U1']), capabilities: { sendAsUser: true, readConversations: true, readHistory: true, liveUpdates: true }, label: 'Acme · alice' };
const TS = '1789171841.148649';
const message = (id = TS, extra: Record<string, unknown> = {}) => ({ id, channelId: 'C1', userId: 'U1', threadRootId: null, clientMsgId: '', body: 'hi', createdAt: '2026-09-11T22:50:41.148Z', editedAt: null, deletedAt: null, pinnedAt: null, pinnedBy: null, replyCount: 0, lastReplyAt: null, systemKind: null, scheduled: false, replyParticipantUserIds: [], reactions: [], files: [], unfurls: [], provenance: { provider: 'slack', openUrl: null, degraded: false, subtype: null }, ...extra });

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
function mockFetch(routes: Record<string, Reply | ((init: RequestInit) => Reply)>) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname + new URL(url).search;
    calls.push({ path, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    const reply = key ? (typeof routes[key] === 'function' ? (routes[key] as (i: RequestInit) => Reply)(init) : routes[key]!) : { status: 404, body: { error: 'not_found' } };
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) } });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe('slackCapabilities', () => {
  it('names the missing scope and marks history limited', () => {
    const caps = slackCapabilities({ sendAsUser: true, readHistory: true, readConversations: true, liveUpdates: false });
    expect(caps.send.state).toBe('supported');
    expect(caps.history.state).toBe('limited');
    expect(caps.reactions.reason).toBe('This Slack app has not been granted reaction permissions.');
    expect(caps.liveUpdates.state).toBe('unavailable');
    expect(caps.artifacts.state).toBe('unavailable');
    expect(caps.notifications.state).toBe('unavailable');
  });
  it('maps emoji to Slack names both ways', () => {
    expect(shortcodeFor('✅')).toBe('white_check_mark');
    expect(shortcodeFor(':custom:')).toBe('custom');
    expect(shortcodeFor('not emoji')).toBeNull();
  });
});

describe('SlackBackend', () => {
  it('turns a 429 into a rate_limited error with the wait, and never retries', async () => {
    const calls = mockFetch({ '/v1/history': { status: 429, body: { error: 'rate_limited' }, headers: { 'retry-after': '42' } } });
    const backend = new SlackBackend(runtime(), connection);
    const error = await backend.history('C1', { cursor: null, limit: 50 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendError);
    expect((error as BackendError).code).toBe('rate_limited');
    expect((error as BackendError).retryAfterMs).toBe(42_000);
    expect(calls.filter((c) => c.path.startsWith('/v1/history')).length).toBe(1);
    expect(calls[0]!.path).toBe('/v1/history?channel=C1&limit=15');
  });

  it('sends the client id so the connector can reconcile, and maps 504 to a retryable timeout', async () => {
    const calls = mockFetch({ '/v1/messages': (init) => (JSON.parse(String(init.body)).text === 'lost' ? { status: 504, body: { error: 'send_unknown' } } : { body: { message: message('1700000000.000001') } }) });
    const backend = new SlackBackend(runtime(), connection);
    const sent = await backend.send({ channelId: 'C1', body: 'hi', clientMsgId: 'cm-1', threadRootId: TS });
    expect(sent.message.clientMsgId).toBe('cm-1');
    expect(calls[0]!.body).toEqual({ channel: 'C1', text: 'hi', client_msg_id: 'cm-1', thread_ts: TS });
    const error = await backend.send({ channelId: 'C1', body: 'lost', clientMsgId: 'cm-2' }).catch((e: unknown) => e);
    expect((error as BackendError).code).toBe('timeout');
    await expect(backend.send({ channelId: 'C1', body: 'x', clientMsgId: 'cm-3', fileIds: ['F1'] })).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('a stream event the client cannot read is dropped; the well-formed ones and the gap signal still arrive', async () => {
    let page = 0;
    mockFetch({
      '/v1/stream': () => (page++ === 0
        ? { body: { events: [{ type: 'message.created', message: { id: TS } }, { type: 'message.created', message: message('1789172009.709539') }, { type: 'something.new', payload: 1 }, { type: 'reaction.added', channelId: 'C1', messageId: TS, emoji: '👀', userId: 'U2' }], seq: 4, gap: false } }
        : { body: { events: [], seq: 4, gap: true } }),
      '/v1/events': { body: { events: [] } },
    });
    const backend = new SlackBackend(runtime(), connection, { autoPoll: false });
    const seen: string[] = [];
    const unsubscribe = backend.subscribe((event) => seen.push(event.type));
    await backend.pollOnce();
    await backend.pollOnce();
    unsubscribe();
    expect(seen).toEqual(['message.created', 'reaction.added', 'stream.degraded', 'stream.recovered']);
    expect(backend.dropped).toBe(2);
  });

  it('a 401 flips auth to reauthorization_required and tells subscribers', async () => {
    mockFetch({ '/v1/conversations': { status: 401, body: { error: 'revoked' } } });
    const backend = new SlackBackend(runtime(), connection);
    const events: string[] = [];
    backend.subscribe((e) => events.push(e.type));
    await expect(backend.listConversations()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(backend.auth().status).toBe('reauthorization_required');
    expect(backend.auth().detail).toMatch(/revoked/i);
    expect(events).toContain('auth.changed');
  });
});
