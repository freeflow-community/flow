// #534, the hardening half: the ways a turn could end with its channel still
// spinning even when nobody stole its progress row.
//
//   1. A failed clear at end-of-turn used to be logged and forgotten — the
//      spinner then sat there until the server's TTL swept it.
//   2. A request that never settles never lets `finish()` settle either, so the
//      clear is never even attempted (and the caller holds a concurrency slot).
//   3. Anything throwing between lighting the spinner and entering the try that
//      puts it out leaks the reporter outright.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowApi, FlowApiError } from '../src/api.js';
import { ProgressReporter } from '../src/progress.js';
import type { FlowSocket } from '../src/gateway.js';
import { AgentBridge } from '../src/bridge.js';
import type { BridgeConfig } from '../src/config.js';
import type { ChannelDTO, MessageDTO } from '@flow/shared';

afterEach(() => vi.unstubAllGlobals());

const socket = { sendTyping: vi.fn() } as unknown as FlowSocket;

describe('the end-of-turn indicator clear', () => {
  it('asks again when the server drops the clear', async () => {
    const setChannelIndicator = vi
      .fn()
      .mockResolvedValueOnce({ state: 'busy' }) // start()
      .mockRejectedValueOnce(new Error('502 bad gateway'))
      .mockResolvedValueOnce({ state: null });
    const api = { setChannelIndicator } as unknown as FlowApi;
    const reporter = new ProgressReporter(api, socket, 'thinking', true, 'chan-1', undefined, () => {});
    reporter.start();
    await reporter.finish();
    expect(setChannelIndicator.mock.calls.map((c) => c[1])).toEqual(['busy', 'none', 'none']);
  });

  it('gives up rather than retrying forever when the server stays down', async () => {
    const setChannelIndicator = vi.fn().mockRejectedValue(new Error('econnrefused'));
    const api = { setChannelIndicator } as unknown as FlowApi;
    const logs: string[] = [];
    const reporter = new ProgressReporter(api, socket, 'thinking', true, 'chan-1', undefined, (m) => logs.push(m));
    reporter.start();
    await expect(reporter.finish()).resolves.toBeUndefined();
    expect(setChannelIndicator.mock.calls.filter((c) => c[1] === 'none')).toHaveLength(3);
  });
});

describe('FlowApi request deadline', () => {
  const api = new FlowApi('https://flow.invalid', 'test-token');

  it('passes an abort signal, so a hung server cannot stall a turn forever', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ state: null })));
    vi.stubGlobal('fetch', fetchMock);
    await api.setChannelIndicator('chan-1', 'none', 90);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports a timeout as an api error, not an unrelated crash', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw timeout; }));
    await expect(api.setChannelIndicator('chan-1', 'none', 90)).rejects.toBeInstanceOf(FlowApiError);
  });
});

describe('a turn that throws before it starts running', () => {
  it('still puts its spinner out', async () => {
    const cfg: BridgeConfig = {
      serverUrl: 'http://localhost:8787',
      agentToken: 'token',
      workspace: null,
      logFile: null,
      runtime: {
        kind: 'demo', command: 'demo', extraArgs: [], cwd: process.cwd(), allowedTools: [],
        maxTurns: 10, timeoutSec: 30, idleTimeoutSec: 10, sessionIdleSec: 600, sessionHardCapSec: 3600,
        mcp: true,
      },
      eventScope: 'mentions',
      respondToAgents: false,
      agentMentionsOnly: false,
      agentChainLimit: 6,
      concurrency: 1,
      progress: 'thinking',
      relayText: true,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = new AgentBridge(cfg) as any;
    b.me = { id: 'aaaaaaaa-0000-0000-0000-000000000001', isAgent: true, displayName: 'Omni' };
    b.workspace = { id: 'ws-1', name: 'QA Lab' };
    b.channels = new Map([['chan-1', { id: 'chan-1', kind: 'dm' } as ChannelDTO]]);
    b.members = new Map();
    b.log = () => {};
    b.socket = socket;
    b.api = {
      sendMessage: vi.fn(async () => ({ id: 'row-1' })),
      editMessage: vi.fn(async () => ({})),
      deleteMessage: vi.fn(async () => {}),
      setChannelIndicator: vi.fn(async () => {}),
    };
    // The one thing between the spinner and the try that used to hold it.
    b.writeMcpConfig = () => { throw new Error('disk full'); };
    const msg = { id: 'msg-1', channelId: 'chan-1', userId: 'bbbbbbbb-0000-0000-0000-000000000002', threadRootId: null, body: 'hi', files: [], reactions: [] } as unknown as MessageDTO;
    const conv = { sessionId: 's-1', started: true, queue: [], running: false, channelId: 'chan-1', replyRoot: undefined, lastMsg: msg };
    await expect(b.processMessage(conv, msg, 'chan-1|')).rejects.toThrow('disk full');
    expect(b.api.setChannelIndicator.mock.calls.map((c: unknown[]) => c[1])).toEqual(['busy', 'none']);
    expect(b.liveRuns.has('chan-1|')).toBe(false);
  });
});
