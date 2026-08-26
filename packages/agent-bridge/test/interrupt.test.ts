// Interrupting an agent turn (issue #67).
//
// Under test (2026-07-28):
//   1. runRuntime settles as `interrupted` when its signal aborts — a stopped
//      run, not an error, and not a timeout.
//   2. 🛑 on a live thinking row stops the turn that row belongs to; the same
//      reaction on an *orphaned* row (bridge died mid-turn) reaps the row.
//   3. `/stop` does the same for clients without a button, and answers
//      honestly when there is nothing running.
//   4. A stopped turn posts what the agent had said, not an apology, and
//      leaves the session resumable.
import { describe, expect, it, vi } from 'vitest';
import type { ChannelDTO, MessageDTO } from '@flow/shared';
import { AgentBridge, INTERRUPT_EMOJI, failureReply, interruptReply } from '../src/bridge.js';
import type { BridgeConfig } from '../src/config.js';
import { runRuntime } from '../src/runtime.js';
import type { RuntimeConfig } from '../src/config.js';

const AGENT = 'aaaaaaaa-0000-0000-0000-000000000001';
const HUMAN = 'bbbbbbbb-0000-0000-0000-000000000002';

function runtimeConfig(over: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    kind: 'demo',
    command: 'demo',
    extraArgs: [],
    cwd: process.cwd(),
    allowedTools: [],
    maxTurns: 10,
    timeoutSec: 30,
    idleTimeoutSec: 10,
    mcp: false,
    ...over,
  } as RuntimeConfig;
}

function config(over: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    serverUrl: 'http://localhost:8787',
    agentToken: 'token',
    logFile: null,
    runtime: runtimeConfig(),
    eventScope: 'mentions',
    respondToAgents: false,
    concurrency: 1,
    progress: 'thinking',
    ...over,
  };
}

function channel(over: Partial<ChannelDTO> = {}): ChannelDTO {
  return {
    id: 'chan-1',
    workspaceId: 'ws-1',
    name: 'general',
    kind: 'standard',
    topic: null,
    isPrivate: false,
    createdBy: AGENT,
    createdAt: '2026-07-28T00:00:00Z',
    archivedAt: null,
    isMember: true,
    lastReadMsgId: null,
    unreadCount: 0,
    notifyLevel: 2,
    ...over,
  } as ChannelDTO;
}

function message(over: Partial<MessageDTO> = {}): MessageDTO {
  return {
    id: 'msg-1',
    channelId: 'chan-1',
    userId: HUMAN,
    threadRootId: null,
    clientMsgId: 'c-1',
    body: 'hello',
    createdAt: '2026-07-28T00:00:00Z',
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    pinnedBy: null,
    replyCount: 0,
    lastReplyAt: null,
    replyParticipantUserIds: [],
    reactions: [],
    files: [],
    ...over,
  } as MessageDTO;
}

/** A bridge with post-`start()` state stubbed in — no network, no socket. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bridge(over: { api?: Record<string, unknown> } = {}): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = new AgentBridge(config()) as any;
  b.me = { id: AGENT, isAgent: true, displayName: 'Omni' };
  b.workspace = { id: 'ws-1', name: 'QA Lab' };
  b.channels = new Map([[channel().id, channel()]]);
  b.members = new Map([[HUMAN, { userId: HUMAN, displayName: 'Alice', isAgent: false }]]);
  b.log = () => {};
  b.api = {
    sendMessage: vi.fn(async () => message()),
    deleteMessage: vi.fn(async () => {}),
    listMessages: vi.fn(async () => ({ messages: [], hasMore: false })),
    ...over.api,
  };
  b.refreshDirectory = async () => {};
  return b;
}

/** A live run registered the way processMessage registers one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function liveRun(b: any, key: string, statusId: string | null) {
  const run = { controller: new AbortController(), progress: { statusId }, stoppedBy: null };
  b.liveRuns.set(key, run);
  return run;
}

describe('runRuntime — abort', () => {
  it('settles as interrupted, without an error to apologise for', async () => {
    const controller = new AbortController();
    const p = runRuntime(runtimeConfig(), {
      sessionId: 's-1',
      resume: false,
      prompt: 'hi',
      systemPrompt: '',
      signal: controller.signal,
      onToolStep: () => {},
      log: () => {},
    });
    controller.abort();
    const result = await p;
    expect(result.ok).toBe(false);
    expect(result.interrupted).toBe(true);
  });

  it('never spawns anything when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runRuntime(runtimeConfig({ kind: 'claude', command: 'definitely-not-a-binary' }), {
      sessionId: 's-1',
      resume: false,
      prompt: 'hi',
      systemPrompt: '',
      signal: controller.signal,
      onToolStep: () => {},
      log: () => {},
    });
    expect(result.interrupted).toBe(true);
    expect(result.error).not.toMatch(/could not spawn/);
  });

  it('completes normally when nothing aborts', async () => {
    const result = await runRuntime(runtimeConfig(), {
      sessionId: 's-1',
      resume: false,
      prompt: 'hi',
      systemPrompt: '',
      signal: new AbortController().signal,
      onToolStep: () => {},
      log: () => {},
    });
    expect(result.ok).toBe(true);
    expect(result.interrupted).toBeUndefined();
  });
});

describe('🛑 on a thinking row', () => {
  it('stops the run that row belongs to, and names who stopped it', async () => {
    const b = bridge();
    const run = liveRun(b, 'chan-1|', 'status-1');
    await b.handleReaction({ messageId: 'status-1', channelId: 'chan-1', emoji: INTERRUPT_EMOJI, userId: HUMAN });
    expect(run.controller.signal.aborted).toBe(true);
    expect(run.stoppedBy).toBe(HUMAN);
  });

  it('ignores other emoji — a 👍 on the status row is not a stop', async () => {
    const b = bridge();
    const run = liveRun(b, 'chan-1|', 'status-1');
    await b.handleReaction({ messageId: 'status-1', channelId: 'chan-1', emoji: '👍', userId: HUMAN });
    expect(run.controller.signal.aborted).toBe(false);
  });

  it('leaves other conversations alone', async () => {
    const b = bridge();
    const mine = liveRun(b, 'chan-1|', 'status-1');
    const other = liveRun(b, 'chan-2|', 'status-2');
    await b.handleReaction({ messageId: 'status-2', channelId: 'chan-1', emoji: INTERRUPT_EMOJI, userId: HUMAN });
    expect(other.controller.signal.aborted).toBe(true);
    expect(mine.controller.signal.aborted).toBe(false);
  });

  it('never lets the agent stop itself', async () => {
    const b = bridge();
    const run = liveRun(b, 'chan-1|', 'status-1');
    await b.handleReaction({ messageId: 'status-1', channelId: 'chan-1', emoji: INTERRUPT_EMOJI, userId: AGENT });
    expect(run.controller.signal.aborted).toBe(false);
  });
});

describe('🛑 on an orphaned thinking row', () => {
  const orphan = message({ id: 'status-9', userId: AGENT, body: '🤖 *thinking…* — Bash: pnpm test' });

  it('reaps the row when no run owns it any more', async () => {
    const b = bridge({ api: { listMessages: vi.fn(async () => ({ messages: [orphan], hasMore: false })) } });
    await b.handleReaction({ messageId: 'status-9', channelId: 'chan-1', emoji: INTERRUPT_EMOJI, userId: HUMAN });
    expect(b.api.deleteMessage).toHaveBeenCalledWith('status-9', { hard: true });
  });

  it('refuses to delete a real message someone reacted 🛑 to', async () => {
    const real = message({ id: 'status-9', userId: AGENT, body: 'here is the answer' });
    const b = bridge({ api: { listMessages: vi.fn(async () => ({ messages: [real], hasMore: false })) } });
    await b.handleReaction({ messageId: 'status-9', channelId: 'chan-1', emoji: INTERRUPT_EMOJI, userId: HUMAN });
    expect(b.api.deleteMessage).not.toHaveBeenCalled();
  });

  it('refuses to delete someone else’s message', async () => {
    const theirs = message({ id: 'status-9', userId: HUMAN, body: '🤖 *thinking…* — pretending' });
    const b = bridge({ api: { listMessages: vi.fn(async () => ({ messages: [theirs], hasMore: false })) } });
    await b.handleReaction({ messageId: 'status-9', channelId: 'chan-1', emoji: INTERRUPT_EMOJI, userId: HUMAN });
    expect(b.api.deleteMessage).not.toHaveBeenCalled();
  });
});

describe('/stop', () => {
  it('stops the run in the conversation it was sent to', async () => {
    const b = bridge();
    const run = liveRun(b, 'chan-1|msg-7', null);
    await b.handleStop(message({ id: 'msg-8', threadRootId: 'msg-7', body: '/stop' }));
    expect(run.controller.signal.aborted).toBe(true);
    expect(run.stoppedBy).toBe(HUMAN);
  });

  it('works before the status row exists — the run is registered first', async () => {
    const b = bridge();
    const run = liveRun(b, 'chan-1|msg-7', null); // no status row posted yet
    await b.handleStop(message({ id: 'msg-8', threadRootId: 'msg-7', body: '/stop' }));
    expect(run.controller.signal.aborted).toBe(true);
  });

  it('says so when there is nothing running', async () => {
    const b = bridge();
    await b.handleStop(message({ id: 'msg-8', threadRootId: 'msg-7', body: '/stop' }));
    expect(b.api.sendMessage).toHaveBeenCalledWith('chan-1', expect.stringContaining('nothing running'), 'msg-7');
  });

  it('is a command, not a turn — it never reaches the queue', async () => {
    const b = bridge();
    b.enqueue = vi.fn();
    b.inScope = async () => true;
    await b.handleMessage(message({ body: '/stop' }));
    expect(b.enqueue).not.toHaveBeenCalled();
  });

  it('is recognised behind a leading mention', async () => {
    const b = bridge();
    b.enqueue = vi.fn();
    b.inScope = async () => true;
    await b.handleMessage(message({ body: `<@${AGENT}> /interrupt` }));
    expect(b.enqueue).not.toHaveBeenCalled();
  });
});

describe('what a stopped turn says', () => {
  it('does not apologise, and hands back the partial work', () => {
    const reply = interruptReply({ ok: false, text: 'I read three files', interrupted: true }, HUMAN);
    expect(reply).toContain('⏹ Stopped');
    expect(reply).toContain(`<@${HUMAN}>`);
    expect(reply).toContain('I read three files');
    expect(reply).not.toMatch(/sorry|error/i);
  });

  it('stands alone when there was nothing to salvage', () => {
    expect(interruptReply({ ok: false, text: '   ', interrupted: true }, null)).toBe('⏹ Stopped.');
  });

  it('leaves the error reply for actual errors', () => {
    expect(failureReply({ ok: false, text: '', error: 'no output for 120s' })).toContain('sorry');
  });
});
