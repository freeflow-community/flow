// start_task: handing work off to a run homed in another channel.
//
// Under test (2026-07-28):
//   1. A task channel converses DM-style — top-level replies, one session —
//      so the run and human interjections share context.
//   2. startTask validates the target, marks the channel, posts a provenance
//      notice, and queues the prompt as a synthetic turn from the requester.
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { ChannelDTO, MessageDTO } from '@flow/shared';
import { AgentBridge, taskSocketPath } from '../src/bridge.js';
import type { BridgeConfig } from '../src/config.js';

const AGENT = 'aaaaaaaa-0000-0000-0000-000000000001';
const HUMAN = 'bbbbbbbb-0000-0000-0000-000000000002';

function config(over: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    serverUrl: 'http://localhost:8787',
    agentToken: 'token',
    logFile: null,
    runtime: {
      kind: 'demo',
      command: 'demo',
      extraArgs: [],
      cwd: process.cwd(),
      allowedTools: [],
      maxTurns: 10,
      timeoutSec: 30,
      idleTimeoutSec: 10,
      mcp: false,
    },
    eventScope: 'mentions',
    respondToAgents: false,
    concurrency: 1,
    progress: 'silent',
    ...over,
  };
}

function channel(over: Partial<ChannelDTO> = {}): ChannelDTO {
  return {
    id: 'task-81',
    workspaceId: 'ws-1',
    name: 'task-81',
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
    channelId: 'task-81',
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
  };
}

/** A bridge with post-`start()` state stubbed in — no network, no socket, and
 * the conversation pump replaced so enqueue never spawns a runtime. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bridge(chans: ChannelDTO[] = [channel()]): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = new AgentBridge(config()) as any;
  b.me = { id: AGENT, isAgent: true, displayName: 'Omni' };
  b.workspace = { id: 'ws-1', name: 'QA Lab' };
  b.channels = new Map(chans.map((c) => [c.id, c]));
  b.members = new Map([[HUMAN, { userId: HUMAN, displayName: 'Alice', isAgent: false }]]);
  b.log = () => {};
  b.api = { sendMessage: vi.fn(async () => message()) };
  b.refreshDirectory = async () => {};
  b.runConversation = async () => {};
  return b;
}

const start = (b: ReturnType<typeof bridge>, over: Record<string, unknown> = {}) =>
  b.startTask({
    channelId: 'task-81',
    prompt: 'work batch 1: #81, #110',
    userId: HUMAN,
    sourceChannelId: 'general',
    ...over,
  });

describe('startTask — validation', () => {
  it('rejects a missing channel or prompt', async () => {
    const b = bridge();
    expect(await b.startTask({})).toEqual({ error: 'start_task needs channelId and prompt' });
    expect(await b.startTask({ channelId: 'task-81', prompt: '   ' })).toMatchObject({ error: expect.any(String) });
  });

  it('rejects an unknown channel', async () => {
    const b = bridge();
    expect(await start(b, { channelId: 'nope' })).toEqual({ error: 'no such channel' });
  });

  it('rejects a channel the agent is not in', async () => {
    const b = bridge([channel({ isMember: false })]);
    const out = await start(b);
    expect(out.error).toMatch(/not a member/);
  });
});

describe('startTask — a successful handoff', () => {
  it('queues the prompt as a turn from the requester in that channel', async () => {
    const b = bridge();
    const out = await start(b);
    expect(out).toEqual({ ok: true, note: 'task run queued in #task-81' });
    const conv = b.conversations.get('task-81|');
    expect(conv.queue).toHaveLength(1);
    expect(conv.queue[0].body).toBe('work batch 1: #81, #110');
    expect(conv.queue[0].userId).toBe(HUMAN);
    expect(conv.queue[0].threadRootId).toBeNull();
  });

  it('posts a provenance notice naming the source channel and requester', async () => {
    const b = bridge([channel(), channel({ id: 'general', name: 'general', createdBy: HUMAN })]);
    await start(b);
    expect(b.api.sendMessage).toHaveBeenCalledWith(
      'task-81',
      expect.stringContaining('handed off from #general'),
    );
    expect(b.api.sendMessage.mock.calls[0][1]).toContain(`<@${HUMAN}>`);
  });

  it('skips the notice when source and target are the same conversation', async () => {
    const b = bridge();
    await start(b, { sourceChannelId: 'task-81' });
    expect(b.api.sendMessage).not.toHaveBeenCalled();
  });

  it('falls back to the agent as requester when the userId is unknown', async () => {
    const b = bridge();
    await start(b, { userId: 'not-a-member' });
    expect(b.conversations.get('task-81|').queue[0].userId).toBe(AGENT);
  });
});

describe('task channels converse DM-style', () => {
  it('replies top-level, not in a thread, once the channel homes a task', async () => {
    const b = bridge();
    expect(b.replyRoot(message({ id: 'msg-9' }))).toBe('msg-9'); // before: ordinary channel
    await start(b);
    expect(b.replyRoot(message({ id: 'msg-9' }))).toBeUndefined(); // after: the channel is the conversation
  });

  it('routes a human top-level message into the run’s own session', async () => {
    const b = bridge();
    await start(b);
    expect(b.convKey(message({ id: 'msg-9' }))).toBe('task-81|');
    expect(b.conversations.has('task-81|')).toBe(true);
  });

  it('keeps thread replies threaded — side conversations stay side', async () => {
    const b = bridge();
    await start(b);
    expect(b.replyRoot(message({ threadRootId: 'root-1' }))).toBe('root-1');
  });

  it('answers top-level messages even in a task channel someone else created', async () => {
    const b = bridge([channel({ createdBy: HUMAN })]);
    await start(b);
    expect(await b.inScope(message({ body: 'how is it going?' }))).toBe(true);
  });
});

describe('taskSocketPath', () => {
  it('is per-agent and stable', () => {
    expect(taskSocketPath(AGENT)).not.toBe(taskSocketPath(HUMAN));
    expect(taskSocketPath(AGENT)).toBe(taskSocketPath(AGENT));
  });

  it('stays under the 104-byte macOS sun_path cap even from a long tmpdir', () => {
    if (process.platform === 'win32') return; // named pipes have no such cap
    // macOS tmpdirs run ~50 chars (/var/folders/xx/<20 chars>/T); a full uuid
    // in the dir name used to push task.sock past the cap → listen EINVAL.
    const macosTmpdirLen = 50;
    const beyondTmp = taskSocketPath(AGENT).length - os.tmpdir().length;
    expect(macosTmpdirLen + beyondTmp).toBeLessThan(104);
  });
});
