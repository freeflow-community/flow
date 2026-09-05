import type { HuddleInviteData, HuddleUpdatedData, MessageDTO } from '@flow/shared';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VoiceConfig } from '../src/config.js';
import {
  HuddleVoiceManager,
  buildVoiceRuntimeInput,
  connectInferenceWebSocket,
  type HuddleVoiceApi,
  type LiveVoiceSessionOptions,
} from '../src/huddle-voice.js';

const AGENT_ID = '00000000-0000-4000-8000-000000000001';
const CALLER_ID = '00000000-0000-4000-8000-000000000002';
const OTHER_ID = '00000000-0000-4000-8000-000000000003';
const CHANNEL_ID = '00000000-0000-4000-8000-000000000004';
const INVITE_ID = '00000000-0000-4000-8000-000000000005';

const managers: HuddleVoiceManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map((manager) => manager.stop())); });

const voice: VoiceConfig = {
  enabled: true,
  sttModel: 'deepgram/flux-general-en',
  ttsModel: 'inworld/inworld-tts-2',
  ttsVoice: 'Ashley',
  inferenceUrl: 'https://agent-gateway.livekit.cloud/v1',
  maxSessionMinutes: 60,
};

function ring(overrides: Partial<HuddleInviteData['invite']> = {}): HuddleInviteData {
  return {
    invite: {
      id: INVITE_ID,
      workspaceId: 'workspace-1',
      channelId: CHANNEL_ID,
      startedBy: CALLER_ID,
      status: 'ringing',
      startedAt: '2026-09-04T12:00:00.000Z',
      answeredAt: null,
      endedAt: null,
      targets: [{ userId: AGENT_ID, status: 'ringing', respondedAt: null }],
      ...overrides,
    },
  };
}

function harness(
  options: {
    config?: VoiceConfig;
    inferenceToken?: string;
    oneToOne?: boolean;
    oneToOneCheck?: () => Promise<boolean>;
  } = {},
) {
  const close = vi.fn(async () => undefined);
  const api: HuddleVoiceApi = {
    acceptHuddleInvite: vi.fn(async () => ({
      token: 'room-token',
      url: 'wss://livekit.example.test',
      inferenceToken: options.inferenceToken ?? 'short-lived-inference-token',
      invite: null,
      unavailable: [],
    })),
    declineHuddleInvite: vi.fn(async () => ({ ok: true })),
    leaveHuddle: vi.fn(async () => ({ ok: true })),
    sendMessage: vi.fn(async () => ({}) as MessageDTO),
  };
  let sessionOptions: LiveVoiceSessionOptions | null = null;
  const runTurn = vi.fn(async () => ({ ok: true, text: 'done', sawSession: true }));
  const log = vi.fn();
  const sessionFactory = vi.fn(async (received: LiveVoiceSessionOptions) => {
    sessionOptions = received;
    return { close };
  });
  const manager = new HuddleVoiceManager({
    api,
    agentId: AGENT_ID,
    agentName: 'Prism',
    config: options.config ?? voice,
    callerName: (id) => (id === CALLER_ID ? 'Mahad' : 'Someone'),
    isOneToOneDm: vi.fn(options.oneToOneCheck ?? (async () => options.oneToOne ?? true)),
    buildInstructions: vi.fn(async () => 'voice instructions'),
    runTurn,
    log,
    sessionFactory,
  });
  managers.push(manager);
  return { manager, api, close, runTurn, log, sessionFactory, getSessionOptions: () => sessionOptions };
}

describe('agent huddle voice', () => {
  it('supplies incoming text to both runtime inputs without posting a DM', async () => {
    const h = harness();
    await h.manager.handleInvite(ring());
    expect(h.manager.handleMessage({ id: 'incoming', channelId: CHANNEL_ID, userId: CALLER_ID,
      body: 'The revised budget is 12500', files: [], systemKind: null,
      createdAt: new Date().toISOString(), editedAt: null, deletedAt: null } as MessageDTO)).toBe(true);
    await h.getSessionOptions()!.runTurn({ prompt: 'What is the budget?', transcript: 'Mahad: What is the budget?',
      signal: new AbortController().signal, onText: vi.fn() });
    const turn = h.runTurn.mock.calls[0]![0];
    expect(turn.prompt).toContain('The revised budget is 12500');
    expect(turn.transcript).toContain('The revised budget is 12500');
    expect(h.api.sendMessage).not.toHaveBeenCalled();
    expect(h.manager.handleMessage({ channelId: 'unrelated' } as MessageDTO)).toBe(false);
  });
  it('builds a latest-turn prompt plus full transcript for Claude and Codex runtimes', () => {
    expect(
      buildVoiceRuntimeInput(
        [
          { role: 'system', text: 'voice instructions' },
          { role: 'assistant', text: 'Hey Mahad, I’m here.' },
          { role: 'user', text: 'fix the PR' },
          { role: 'assistant', text: 'I found the failing test.' },
          { role: 'user', text: ' and run it again ' },
        ],
        'Mahad',
        'Prism',
      ),
    ).toEqual({
      prompt: 'and run it again',
      transcript:
        'Prism: Hey Mahad, I’m here.\nMahad: fix the PR\nPrism: I found the failing test.\nMahad: and run it again',
    });
  });

  it('connects speech with only the short-lived inference token', async () => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    let authorization = '';
    let pathname = '';
    const received = new Promise<Record<string, unknown>>((resolve) => {
      server.once('connection', (socket, request) => {
        authorization = request.headers.authorization ?? '';
        pathname = request.url ?? '';
        socket.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
      });
    });

    const socket = await connectInferenceWebSocket(
      `http://127.0.0.1:${port}/v1`,
      '/stt',
      'ephemeral-agent-grant',
      1_000,
      { type: 'session.create', model: 'test-stt' },
    );
    const session = await received;

    expect(authorization).toBe('Bearer ephemeral-agent-grant');
    expect(pathname).toBe('/v1/stt');
    expect(session).toEqual({ type: 'session.create', model: 'test-stt' });
    socket.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('accepts its ring and links the realtime session to the exact caller', async () => {
    const h = harness();

    await h.manager.handleInvite(ring());
    await h.manager.handleInvite(ring()); // duplicate delivery is harmless

    expect(h.api.acceptHuddleInvite).toHaveBeenCalledTimes(1);
    expect(h.api.acceptHuddleInvite).toHaveBeenCalledWith(INVITE_ID);
    expect(h.sessionFactory).toHaveBeenCalledTimes(1);
    expect(h.getSessionOptions()).toMatchObject({
      url: 'wss://livekit.example.test',
      token: 'room-token',
      inferenceToken: 'short-lived-inference-token',
      callerId: CALLER_ID,
      callerName: 'Mahad',
      agentName: 'Prism',
      instructions: 'voice instructions',
    });
    expect(h.manager.activeChannelId).toBe(CHANNEL_ID);
  });

  it('runs spoken requests through one resumable bridge runtime session', async () => {
    const h = harness();
    await h.manager.handleInvite(ring());

    const signal = new AbortController().signal;
    const onText = vi.fn();
    await h.getSessionOptions()!.runTurn({
      prompt: 'fix the PR',
      transcript: 'Mahad: fix the PR',
      signal,
      onText,
    });
    await h.getSessionOptions()!.runTurn({
      prompt: 'and run the tests',
      transcript: 'Mahad: fix the PR\nPrism: on it\nMahad: and run the tests',
      signal,
      onText,
    });

    expect(h.runTurn).toHaveBeenCalledTimes(2);
    const first = h.runTurn.mock.calls[0]![0];
    const second = h.runTurn.mock.calls[1]![0];
    expect(first).toMatchObject({ prompt: 'fix the PR', resume: false, systemPrompt: 'voice instructions' });
    expect(first.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toMatchObject({ prompt: 'and run the tests', resume: true });
    expect(second.sessionId).toBe(first.sessionId);
  });

  it('needs no model-provider API key on the bot host', async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const h = harness();

    await h.manager.handleInvite(ring());

    expect(h.api.acceptHuddleInvite).toHaveBeenCalledWith(INVITE_ID);
    expect(h.sessionFactory).toHaveBeenCalledTimes(1);
    expect(h.api.sendMessage).not.toHaveBeenCalled();
    expect(JSON.stringify(h.log.mock.calls)).not.toContain('short-lived-inference-token');
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
  });

  it('leaves with a clear failure when the Flow server is too old to mint speech access', async () => {
    const h = harness({ inferenceToken: ' ' });

    await h.manager.handleInvite(ring());

    expect(h.api.leaveHuddle).toHaveBeenCalledWith(CHANNEL_ID);
    expect(h.api.sendMessage).toHaveBeenCalledWith(CHANNEL_ID, expect.stringContaining('couldn’t start'));
    expect(h.sessionFactory).not.toHaveBeenCalled();
  });

  it('declines with a useful chat explanation when voice is explicitly disabled', async () => {
    const h = harness({ config: { ...voice, enabled: false } });

    await h.manager.handleInvite(ring());

    expect(h.api.declineHuddleInvite).toHaveBeenCalledWith(INVITE_ID);
    expect(h.api.sendMessage).toHaveBeenCalledWith(CHANNEL_ID, expect.stringContaining('voice.enabled'));
    expect(h.api.acceptHuddleInvite).not.toHaveBeenCalled();
  });

  it('ignores a ring meant for somebody else', async () => {
    const h = harness();
    await h.manager.handleInvite(
      ring({ targets: [{ userId: OTHER_ID, status: 'ringing', respondedAt: null }] }),
    );

    expect(h.api.acceptHuddleInvite).not.toHaveBeenCalled();
    expect(h.api.declineHuddleInvite).not.toHaveBeenCalled();
  });

  it('declines group calls so it never pretends to hear participants it is not linked to', async () => {
    const h = harness({ oneToOne: false });

    await h.manager.handleInvite(ring());

    expect(h.api.declineHuddleInvite).toHaveBeenCalledWith(INVITE_ID);
    expect(h.api.sendMessage).toHaveBeenCalledWith(CHANNEL_ID, expect.stringContaining('one-to-one'));
    expect(h.api.acceptHuddleInvite).not.toHaveBeenCalled();
  });

  it('closes and leaves when the caller disappears from the huddle roster', async () => {
    const h = harness();
    await h.manager.handleInvite(ring());
    const roster: HuddleUpdatedData = {
      channelId: CHANNEL_ID,
      participants: [{ userId: AGENT_ID, joinedAt: '2026-09-04T12:00:01.000Z' }],
    };

    await h.manager.handleRoster(roster);

    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.api.leaveHuddle).toHaveBeenCalledWith(CHANNEL_ID);
    expect(h.manager.activeChannelId).toBeNull();
  });

  it('leaves the Flow huddle when the realtime session ends itself', async () => {
    const h = harness();
    await h.manager.handleInvite(ring());

    h.getSessionOptions()!.onEnded();

    await vi.waitFor(() => expect(h.api.leaveHuddle).toHaveBeenCalledWith(CHANNEL_ID));
    expect(h.manager.activeChannelId).toBeNull();
  });

  it('closes the audio session when the invite reaches a terminal state', async () => {
    const h = harness();
    await h.manager.handleInvite(ring());

    await h.manager.handleInvite(
      ring({
        status: 'ended',
        endedAt: '2026-09-04T12:05:00.000Z',
        targets: [{ userId: AGENT_ID, status: 'accepted', respondedAt: '2026-09-04T12:00:01.000Z' }],
      }),
    );

    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.api.leaveHuddle).toHaveBeenCalledWith(CHANNEL_ID);
    expect(h.manager.activeChannelId).toBeNull();
  });

  it('ends the call when a participant loses access, but ignores unrelated membership changes', async () => {
    const h = harness();
    await h.manager.handleInvite(ring());
    await h.manager.memberLeft(CHANNEL_ID, OTHER_ID);
    expect(h.close).not.toHaveBeenCalled();
    await h.manager.memberLeft(CHANNEL_ID, AGENT_ID);
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.manager.activeChannelId).toBeNull();
  });

  it('leaves and reports a clear failure if LiveKit audio startup fails', async () => {
    const h = harness();
    h.sessionFactory.mockRejectedValueOnce(new Error('native startup failed'));

    await h.manager.handleInvite(ring());

    expect(h.api.leaveHuddle).toHaveBeenCalledWith(CHANNEL_ID);
    expect(h.api.sendMessage).toHaveBeenCalledWith(CHANNEL_ID, expect.stringContaining('couldn’t start'));
    expect(h.manager.activeChannelId).toBeNull();
  });

  it('declines a second ring while already talking in another huddle', async () => {
    const h = harness();
    await h.manager.handleInvite(ring());
    const second = ring({
      id: '00000000-0000-4000-8000-000000000006',
      channelId: '00000000-0000-4000-8000-000000000007',
      startedBy: OTHER_ID,
    });

    await h.manager.handleInvite(second);

    expect(h.api.declineHuddleInvite).toHaveBeenCalledWith(second.invite.id);
    expect(h.api.sendMessage).toHaveBeenCalledWith(second.invite.channelId, expect.stringContaining('another huddle'));
    expect(h.sessionFactory).toHaveBeenCalledTimes(1);
  });

  it('reserves the call slot while an invite is still in preflight', async () => {
    let releasePreflight!: () => void;
    const preflight = new Promise<void>((resolve) => {
      releasePreflight = resolve;
    });
    const firstCheck = vi.fn(async () => preflight.then(() => true));
    const h = harness({ oneToOneCheck: firstCheck });
    const second = ring({
      id: '00000000-0000-4000-8000-000000000006',
      channelId: '00000000-0000-4000-8000-000000000007',
      startedBy: OTHER_ID,
    });

    const firstAnswer = h.manager.handleInvite(ring());
    await vi.waitFor(() => expect(firstCheck).toHaveBeenCalledTimes(1));
    await h.manager.handleInvite(second);
    releasePreflight();
    await firstAnswer;

    expect(h.api.acceptHuddleInvite).toHaveBeenCalledTimes(1);
    expect(h.api.acceptHuddleInvite).toHaveBeenCalledWith(INVITE_ID);
    expect(h.api.declineHuddleInvite).toHaveBeenCalledWith(second.invite.id);
  });

  it('does not answer an invite that ends during preflight', async () => {
    let releasePreflight!: () => void;
    const preflight = new Promise<void>((resolve) => {
      releasePreflight = resolve;
    });
    const firstCheck = vi.fn(async () => preflight.then(() => true));
    const h = harness({ oneToOneCheck: firstCheck });

    const answer = h.manager.handleInvite(ring());
    await vi.waitFor(() => expect(firstCheck).toHaveBeenCalledTimes(1));
    await h.manager.handleInvite(ring({ status: 'cancelled', endedAt: '2026-09-04T12:00:01.000Z' }));
    releasePreflight();
    await answer;

    expect(h.api.acceptHuddleInvite).not.toHaveBeenCalled();
    expect(h.sessionFactory).not.toHaveBeenCalled();
  });

  it('leaves without starting audio when the bridge stops during accept', async () => {
    const h = harness();
    let finishAccept!: (room: Awaited<ReturnType<HuddleVoiceApi['acceptHuddleInvite']>>) => void;
    const accepting = new Promise<Awaited<ReturnType<HuddleVoiceApi['acceptHuddleInvite']>>>((resolve) => {
      finishAccept = resolve;
    });
    h.api.acceptHuddleInvite = vi.fn(async () => accepting);

    const answer = h.manager.handleInvite(ring());
    await vi.waitFor(() => expect(h.api.acceptHuddleInvite).toHaveBeenCalledTimes(1));
    await h.manager.stop();
    finishAccept({
      token: 'room-token',
      url: 'wss://livekit.example.test',
      invite: null,
      unavailable: [],
    });
    await answer;

    expect(h.sessionFactory).not.toHaveBeenCalled();
    expect(h.api.leaveHuddle).toHaveBeenCalledWith(CHANNEL_ID);
  });
});
