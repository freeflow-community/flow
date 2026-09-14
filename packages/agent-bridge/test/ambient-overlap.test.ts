// #522: a follow-up turn (the SDK re-invoking the agent when a background task
// finished) and a turn a message asked for, alive at once in one conversation.
//
// Driven end to end through the bridge against the fake stream-json CLI in
// fixtures/session-runtime.mjs, so the overlap comes from the real session gate
// rather than from a test poking the maps. What must hold in every ordering:
// both replies post, every reporter that started is finished (its 30s interval
// is what re-asserted a dead channel spinner forever), and the spinner ends off.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import type { ChannelDTO, MessageDTO } from '@flow/shared';
import { AgentBridge } from '../src/bridge.js';
import type { BridgeConfig } from '../src/config.js';
import { ProgressReporter } from '../src/progress.js';

const FAKE = fileURLToPath(new URL('./fixtures/session-runtime.mjs', import.meta.url));
const AGENT = 'aaaaaaaa-0000-0000-0000-000000000001';
const HUMAN = 'bbbbbbbb-0000-0000-0000-000000000002';
const KEY = 'chan-1|';
const posix = process.platform !== 'win32';

function config(): BridgeConfig {
  return {
    serverUrl: 'http://localhost:8787',
    agentToken: 'token',
    workspace: null,
    logFile: null,
    runtime: {
      kind: 'claude', command: FAKE, extraArgs: [], cwd: os.tmpdir(), allowedTools: [],
      maxTurns: 10, timeoutSec: 30, idleTimeoutSec: 10, sessionIdleSec: 600, sessionHardCapSec: 3600,
      mcp: false,
    },
    eventScope: 'mentions',
    respondToAgents: false,
    agentMentionsOnly: false,
    agentChainLimit: 6,
    concurrency: 2,
    progress: 'thinking',
    relayText: false,
  };
}

function message(id: string, body: string): MessageDTO {
  return { id, channelId: 'chan-1', userId: HUMAN, threadRootId: null, body, files: [], reactions: [] } as unknown as MessageDTO;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bridge = any;
const open: Bridge[] = [];

function bridge(): Bridge {
  const b = new AgentBridge(config()) as Bridge;
  b.me = { id: AGENT, isAgent: true, displayName: 'Omni' };
  b.workspace = { id: 'ws-1', name: 'QA Lab' };
  b.channels = new Map([['chan-1', { id: 'chan-1', kind: 'dm' } as ChannelDTO]]);
  b.members = new Map([[HUMAN, { userId: HUMAN, displayName: 'Alice', isAgent: false }]]);
  b.log = () => {};
  b.socket = { sendTyping: () => {} };
  b.replyRoot = () => undefined;
  // The message body is the fixture's script.
  b.buildPrompt = async (_conv: unknown, msg: MessageDTO) => msg.body;
  let n = 0;
  b.api = {
    sendMessage: vi.fn(async (_c: string, body: string) => message(`row-${++n}`, body)),
    editMessage: vi.fn(async () => ({})),
    deleteMessage: vi.fn(async () => {}),
    setChannelIndicator: vi.fn(async () => ({ state: null })),
  };
  open.push(b);
  return b;
}

function conversation(): Record<string, unknown> {
  const msg = message('msg-0', '');
  return { sessionId: `s-${Math.random()}`, started: true, queue: [], running: false, channelId: 'chan-1', replyRoot: undefined, lastMsg: msg };
}

async function until(pred: () => boolean, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const replies = (b: Bridge): string[] => b.api.sendMessage.mock.calls.map((c: unknown[]) => c[1] as string);
const indicatorStates = (b: Bridge): string[] => b.api.setChannelIndicator.mock.calls.map((c: unknown[]) => c[1] as string);

/** Every reporter started during a test, and the tool steps each was handed. */
let started: ProgressReporter[] = [];
const steps = new Map<ProgressReporter, string[]>();

beforeEach(() => {
  started = [];
  steps.clear();
  const start = ProgressReporter.prototype.start;
  vi.spyOn(ProgressReporter.prototype, 'start').mockImplementation(function (this: ProgressReporter) {
    started.push(this);
    return start.call(this);
  });
  const onStep = ProgressReporter.prototype.onStep;
  vi.spyOn(ProgressReporter.prototype, 'onStep').mockImplementation(function (this: ProgressReporter, step: string) {
    steps.set(this, [...(steps.get(this) ?? []), step]);
    return onStep.call(this, step);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const b of open.splice(0)) b.sessions.killAll();
});

/** No reporter left running, nothing holding the channel, spinner off. */
async function expectAllSettled(b: Bridge): Promise<void> {
  await until(() => started.every((r) => (r as unknown as { finished: boolean }).finished));
  // finish() is async; let the clears land.
  await until(() => !b.indicatorLeases.isHeld('chan-1'));
  await new Promise((r) => setTimeout(r, 50));
  expect(indicatorStates(b).at(-1)).toBe('none');
  expect(b.liveRuns.has(KEY)).toBe(false);
  expect(b.ambientRuns.has(KEY)).toBe(false);
}

describe.skipIf(!posix)('overlapping follow-up and solicited turns (#522)', () => {
  it('race 1: a message during a follow-up turn — both reply, spinner ends off', async () => {
    const b = bridge();
    const conv = conversation();
    await b.processMessage(conv, message('msg-1', 'bgslow 100 600 build\ndone kicked off'), KEY);
    await until(() => b.ambientRuns.has(KEY));

    // Lands mid-follow-up-turn: registered now, queued behind it in the CLI.
    const second = b.processMessage(conv, message('msg-2', 'done answered you'), KEY);
    await until(() => b.liveRuns.has(KEY));
    expect(b.ambientRuns.has(KEY)).toBe(true);
    await second;
    await until(() => replies(b).includes('build finished'));

    expect(replies(b)).toContain('kicked off');
    expect(replies(b)).toContain('answered you');
    // The follow-up turn narrated into its own row, not the queued message's.
    const [, ambient, solicited] = started;
    expect(steps.get(ambient!)?.length ?? 0, JSON.stringify([...steps.values()])).toBeGreaterThan(0);
    expect(steps.get(solicited!) ?? []).toEqual([]);
    expect(started).toHaveLength(3);
    await expectAllSettled(b);
  });

  it('race 2: a follow-up turn starting while a message is registered but queued — it replies, nothing leaks', async () => {
    const b = bridge();
    const conv = conversation();
    await b.processMessage(conv, message('msg-1', 'bgslow 150 300 build\ndone kicked off'), KEY);

    // The message registers its run, then is held up before reaching the CLI…
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    b.buildPrompt = async (_c: unknown, msg: MessageDTO) => {
      await held;
      return msg.body;
    };
    const second = b.processMessage(conv, message('msg-2', 'done answered you'), KEY);
    // …and the follow-up turn starts in that gap.
    await until(() => b.ambientRuns.has(KEY));
    expect(b.liveRuns.get(KEY).ambient).toBe(false);
    release();
    await second;
    await until(() => replies(b).includes('build finished'));

    expect(replies(b)).toContain('answered you');
    expect(started).toHaveLength(3); // the follow-up turn got a reporter of its own
    await expectAllSettled(b);
  });
});

describe.skipIf(!posix)('every turn-ending path finishes the reporters it started (#522)', () => {
  it('a turn that errors', async () => {
    const b = bridge();
    await b.processMessage(conversation(), message('msg-1', 'fail error_max_turns'), KEY);
    expect(started).toHaveLength(1);
    await expectAllSettled(b);
  });

  it('a turn stopped with /stop', async () => {
    const b = bridge();
    const turn = b.processMessage(conversation(), message('msg-1', 'wait 5000\ndone never'), KEY);
    await until(() => b.liveRuns.has(KEY) && b.sessions.get(KEY) !== undefined);
    await new Promise((r) => setTimeout(r, 100));
    await b.handleStop(message('msg-2', '/stop'));
    await turn;
    expect(replies(b).some((r) => /stopped/i.test(r))).toBe(true);
    await expectAllSettled(b);
  });

  it('a follow-up turn stopped with 🛑 on its row, while a message waits behind it', async () => {
    const b = bridge();
    const conv = conversation();
    await b.processMessage(conv, message('msg-1', 'bgslow 50 5000 build\ndone kicked off'), KEY);
    await until(() => b.ambientRuns.get(KEY)?.progress.statusId);
    const queued = b.processMessage(conv, message('msg-2', 'done answered you'), KEY);
    await until(() => b.liveRuns.has(KEY));
    await b.handleReaction({ emoji: '🛑', userId: HUMAN, messageId: b.ambientRuns.get(KEY).progress.statusId, channelId: 'chan-1' });
    await queued;
    expect(replies(b)).toContain('answered you');
    await expectAllSettled(b);
  });

  it('a follow-up turn whose session is reset out from under it', async () => {
    const b = bridge();
    const conv = conversation();
    b.conversations.set(KEY, conv);
    await b.processMessage(conv, message('msg-1', 'bgslow 50 5000 build\ndone kicked off'), KEY);
    await until(() => b.ambientRuns.has(KEY));
    await b.handleReset(message('msg-2', '/reset'));
    await expectAllSettled(b);
  });
});

describe('clearing the indicator outside a turn (#522)', () => {
  it('clears on session dispose when nothing of ours still holds the channel', async () => {
    const b = bridge();
    const conv = conversation();
    b.sessions.session(KEY, () => b.sessionOpts(conv, KEY));
    b.sessions.dispose(KEY, 'context reset');
    await vi.waitFor(() => expect(b.api.setChannelIndicator).toHaveBeenCalledWith('chan-1', 'none'));
  });

  it('leaves the spinner alone on dispose while another turn still owns it', async () => {
    const b = bridge();
    const conv = conversation();
    b.indicatorLeases.hold('chan-1');
    b.sessions.session(KEY, () => b.sessionOpts(conv, KEY));
    b.sessions.dispose(KEY, 'context reset');
    await new Promise((r) => setTimeout(r, 10));
    expect(b.api.setChannelIndicator).not.toHaveBeenCalled();
  });

  it('clears leftovers on startup, only where a channel still shows one', async () => {
    const b = bridge();
    b.channels = new Map([
      ['chan-1', { id: 'chan-1', kind: 'dm', indicator: 'busy' } as unknown as ChannelDTO],
      ['chan-2', { id: 'chan-2', kind: 'dm', indicator: null } as unknown as ChannelDTO],
    ]);
    b.clearLeftoverIndicators();
    await new Promise((r) => setTimeout(r, 10));
    expect(b.api.setChannelIndicator.mock.calls).toEqual([['chan-1', 'none']]);
  });

  it('clears on shutdown for every conversation it had', async () => {
    const b = bridge();
    b.socket = { close: () => {}, sendTyping: () => {} };
    b.huddleVoice = null;
    b.conversations.set(KEY, conversation());
    await b.stop();
    expect(b.api.setChannelIndicator).toHaveBeenCalledWith('chan-1', 'none');
  });
});
