// #519, bridge side: what the conversation sees when a session outlives a turn.
//
// The session layer's own behaviour is in session.test.ts; this covers the
// wiring — a turn the SDK starts by itself gets a progress row and posts its
// reply like any other, 🛑 on that row reaches the session, and /reset and
// shutdown end the process rather than leaking it.
import { describe, expect, it, vi } from 'vitest';
import type { ChannelDTO, MessageDTO } from '@flow/shared';
import { AgentBridge } from '../src/bridge.js';
import type { BridgeConfig, RuntimeConfig } from '../src/config.js';

const AGENT = 'aaaaaaaa-0000-0000-0000-000000000001';
const HUMAN = 'bbbbbbbb-0000-0000-0000-000000000002';

function config(runtime: Partial<RuntimeConfig> = {}): BridgeConfig {
  return {
    serverUrl: 'http://localhost:8787',
    agentToken: 'token',
    workspace: null,
    logFile: null,
    runtime: {
      kind: 'claude',
      command: 'claude',
      extraArgs: [],
      cwd: process.cwd(),
      allowedTools: [],
      maxTurns: 10,
      timeoutSec: 30,
      idleTimeoutSec: 10,
      sessionIdleSec: 600,
      sessionHardCapSec: 3600,
      mcp: false,
      ...runtime,
    },
    eventScope: 'mentions',
    respondToAgents: false,
    agentMentionsOnly: false,
    agentChainLimit: 6,
    concurrency: 1,
    progress: 'silent', // no network from the progress row in these tests
    relayText: true,
  };
}

function message(over: Partial<MessageDTO> = {}): MessageDTO {
  return {
    id: 'msg-1',
    channelId: 'chan-1',
    userId: HUMAN,
    threadRootId: null,
    body: 'hello',
    files: [],
    reactions: [],
    ...over,
  } as MessageDTO;
}

/** A bridge with post-`start()` state stubbed in — no network, no socket. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bridge(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = new AgentBridge(config()) as any;
  b.me = { id: AGENT, isAgent: true, displayName: 'Omni' };
  b.workspace = { id: 'ws-1', name: 'QA Lab' };
  b.channels = new Map([['chan-1', { id: 'chan-1', kind: 'dm' } as ChannelDTO]]);
  b.members = new Map([[HUMAN, { userId: HUMAN, displayName: 'Alice', isAgent: false }]]);
  b.log = () => {};
  b.socket = { sendTyping: () => {} };
  b.api = { sendMessage: vi.fn(async () => message()), setChannelIndicator: vi.fn(async () => {}) };
  return b;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function conversation(): any {
  return {
    sessionId: 's-1',
    started: true,
    queue: [],
    running: false,
    channelId: 'chan-1',
    replyRoot: undefined,
    lastMsg: message(),
  };
}

describe('a turn nobody asked for', () => {
  it('posts its reply to the conversation like any other', async () => {
    const b = bridge();
    const conv = conversation();
    b.startAmbientTurn('chan-1|', conv);
    expect(b.liveRuns.get('chan-1|').ambient).toBe(true);
    await b.finishAmbientTurn('chan-1|', conv, { ok: true, text: 'the build passed' });
    expect(b.api.sendMessage).toHaveBeenCalledWith('chan-1', 'the build passed', undefined);
    expect(b.liveRuns.has('chan-1|')).toBe(false);
  });

  it('says so when the follow-up turn failed instead of going quiet', async () => {
    const b = bridge();
    const conv = conversation();
    b.startAmbientTurn('chan-1|', conv);
    await b.finishAmbientTurn('chan-1|', conv, { ok: false, text: '', error: 'runtime reported an error' });
    expect(b.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(b.api.sendMessage.mock.calls[0][1]).toMatch(/runtime reported an error/);
  });

  it('posts nothing when the agent had nothing to add', async () => {
    const b = bridge();
    const conv = conversation();
    b.startAmbientTurn('chan-1|', conv);
    await b.finishAmbientTurn('chan-1|', conv, { ok: true, text: '   ' });
    expect(b.api.sendMessage).not.toHaveBeenCalled();
  });

  it('does not steal the row from a turn a message asked for', () => {
    const b = bridge();
    const conv = conversation();
    b.liveRuns.set('chan-1|', { controller: new AbortController(), progress: { statusId: null }, stoppedBy: null, ambient: false });
    b.startAmbientTurn('chan-1|', conv);
    expect(b.liveRuns.get('chan-1|').ambient).toBe(false);
  });

  // 🛑 on a follow-up row has no runTurn promise to abort — it has to reach
  // the session process directly.
  it('routes 🛑 on its row to the session itself', () => {
    const b = bridge();
    const interrupt = vi.fn();
    b.sessions.get = () => ({ interrupt });
    const run = { controller: new AbortController(), progress: { statusId: 'row-1' }, stoppedBy: null, ambient: true };
    b.liveRuns.set('chan-1|', run);
    b.stopRun('chan-1|', run, HUMAN);
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(run.stoppedBy).toBe(HUMAN);
  });
});

describe('session lifecycle from the bridge', () => {
  it('ends the session process on /reset', async () => {
    const b = bridge();
    const dispose = vi.spyOn(b.sessions, 'dispose');
    b.replyRoot = () => undefined;
    b.conversations.set('chan-1|', conversation());
    await b.handleReset(message());
    expect(b.conversations.has('chan-1|')).toBe(false);
    expect(dispose).toHaveBeenCalledWith('chan-1|', 'context reset');
  });

  it('kills every session on shutdown', async () => {
    const b = bridge();
    const killAll = vi.spyOn(b.sessions, 'killAll');
    b.socket = { close: () => {}, sendTyping: () => {} };
    b.huddleVoice = null;
    await b.stop();
    expect(killAll).toHaveBeenCalledTimes(1);
  });

  it('builds a spawn spec from the newest message, not the one that opened the conversation', () => {
    const b = bridge();
    const conv = conversation();
    conv.lastMsg = message({ id: 'msg-9', body: 'the latest' });
    const opts = b.sessionOpts(conv, 'chan-1|');
    expect(opts.sessionId).toBe('s-1');
    expect(opts.resume).toBe(true);
    const spec = opts.makeSpawn();
    expect(spec.systemPrompt).toContain('Omni');
    expect(spec.mcpConfigPath).toBeUndefined(); // mcp off in this config
  });
});
