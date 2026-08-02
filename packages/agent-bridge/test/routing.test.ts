// Which messages the bridge answers, and where the answer goes.
//
// Two rules under test (2026-07-22):
//   1. A top-level *channel* message we answer is answered in a NEW thread
//      rooted at it — DMs stay inline.
//   2. Once we've spoken in a thread, we answer every reply in it, mentioned
//      or not.
import { describe, expect, it } from 'vitest';
import type { ChannelDTO, MessageDTO } from '@flow/shared';
import { AgentBridge, failureReply } from '../src/bridge.js';
import type { BridgeConfig } from '../src/config.js';

const AGENT = 'aaaaaaaa-0000-0000-0000-000000000001';
const HUMAN = 'bbbbbbbb-0000-0000-0000-000000000002';
const OTHER_AGENT = 'cccccccc-0000-0000-0000-000000000003';

function config(over: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    serverUrl: 'http://localhost:8787',
    agentToken: 'token',
    logFile: null, // keep the test off the filesystem
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
    id: 'chan-1',
    workspaceId: 'ws-1',
    name: 'general',
    kind: 'standard',
    topic: null,
    isPrivate: false,
    createdBy: HUMAN,
    createdAt: '2026-07-22T00:00:00Z',
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
    systemKind: null,
    createdAt: '2026-07-22T00:00:00Z',
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

/** A bridge with its post-`start()` state stubbed in (no network, no socket). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bridge(cfg = config(), chans: ChannelDTO[] = [channel()]): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = new AgentBridge(cfg) as any;
  b.me = { id: AGENT, isAgent: true, displayName: 'Omni' };
  b.workspace = { id: 'ws-1', name: 'QA Lab' };
  b.channels = new Map(chans.map((c) => [c.id, c]));
  b.members = new Map([
    [HUMAN, { userId: HUMAN, displayName: 'Alice', isAgent: false }],
    [OTHER_AGENT, { userId: OTHER_AGENT, displayName: 'Bot', isAgent: true }],
  ]);
  b.log = () => {};
  return b;
}

describe('replyRoot — where the answer goes', () => {
  it('opens a new thread on a top-level channel message', () => {
    const b = bridge();
    expect(b.replyRoot(message({ id: 'msg-9' }))).toBe('msg-9');
  });

  it('stays in the thread for a thread reply', () => {
    const b = bridge();
    expect(b.replyRoot(message({ id: 'msg-9', threadRootId: 'root-1' }))).toBe('root-1');
  });

  it('answers a DM inline — the DM is already the conversation', () => {
    const b = bridge(config(), [channel({ id: 'dm-1', kind: 'dm', name: null })]);
    expect(b.replyRoot(message({ channelId: 'dm-1' }))).toBeUndefined();
  });

  it('answers a group DM inline too', () => {
    const b = bridge(config(), [channel({ id: 'gdm-1', kind: 'group_dm', name: null })]);
    expect(b.replyRoot(message({ channelId: 'gdm-1' }))).toBeUndefined();
  });

  it('keys the conversation by the thread it opens, so the session continues there', () => {
    const b = bridge();
    const top = message({ id: 'msg-9' });
    const replyInThatThread = message({ id: 'msg-10', threadRootId: 'msg-9' });
    expect(b.convKey(top)).toBe(b.convKey(replyInThatThread));
  });
});

describe('inScope — channels the agent created', () => {
  const mine = () => channel({ createdBy: AGENT });

  it('answers a top-level message with no mention', async () => {
    const b = bridge(config(), [mine()]);
    expect(await b.inScope(message({ body: 'no mention here' }))).toBe(true);
  });

  it('still ignores a top-level message in a channel someone else created', async () => {
    const b = bridge(); // createdBy: HUMAN
    expect(await b.inScope(message({ body: 'no mention here' }))).toBe(false);
  });

  it('does not answer a thread reply just because we own the channel', async () => {
    // The thread belongs to whoever is in it; owning the room is not owning
    // every side conversation in it.
    const b = bridge(config(), [mine()]);
    b.api.listThread = async () => [message({ id: 'root-1', userId: HUMAN })];
    expect(await b.inScope(message({ threadRootId: 'root-1', body: 'plain' }))).toBe(false);
  });

  it('answers a thread reply in our channel once we have spoken in that thread', async () => {
    const b = bridge(config(), [mine()]);
    b.conversations.set('chan-1|root-1', { sessionId: 's', started: true, queue: [], running: false });
    expect(await b.inScope(message({ threadRootId: 'root-1', body: 'plain' }))).toBe(true);
  });

  it('never answers its own message in its own channel', async () => {
    const b = bridge(config(), [mine()]);
    expect(await b.inScope(message({ userId: AGENT, body: 'mine' }))).toBe(false);
  });

  it('still skips another agent in our channel unless respondToAgents', async () => {
    const b = bridge(config(), [mine()]);
    expect(await b.inScope(message({ userId: OTHER_AGENT, body: 'hi' }))).toBe(false);
  });

  it('opens a thread on the message it answers, as usual', () => {
    const b = bridge(config(), [mine()]);
    expect(b.replyRoot(message({ id: 'msg-9' }))).toBe('msg-9');
  });
});

describe('inScope — channel event lines (#120)', () => {
  // The server posts joins/leaves as real messages with a `systemKind`
  // ("Alice joined the channel"). In a channel the agent owns, every top-level
  // message counts as addressed to it — which used to spawn a whole runtime
  // turn for someone walking in the door. A notice is not a request.
  const joined = (over: Partial<MessageDTO> = {}) =>
    message({ body: 'Alice joined the channel', systemKind: 'member_joined', ...over });

  it('does not answer a join notice in a channel the agent created', async () => {
    const b = bridge(config(), [channel({ createdBy: AGENT })]);
    expect(await b.inScope(joined())).toBe(false);
  });

  it('does not answer a leave notice either', async () => {
    const b = bridge(config(), [channel({ createdBy: AGENT })]);
    expect(await b.inScope(joined({ body: 'Alice left the channel', systemKind: 'member_left' }))).toBe(
      false,
    );
  });

  it('does not answer a join notice in a start_task channel', async () => {
    const b = bridge();
    b.taskChannels.add('chan-1');
    expect(await b.inScope(joined())).toBe(false);
  });

  it('does not answer a join notice under eventScope "all"', async () => {
    const b = bridge(config({ eventScope: 'all' }));
    expect(await b.inScope(joined())).toBe(false);
  });

  it('still answers a real message in the same channel', async () => {
    const b = bridge(config(), [channel({ createdBy: AGENT })]);
    expect(await b.inScope(message({ body: 'now that you are here, status?' }))).toBe(true);
  });
});

describe('inScope — thread participation', () => {
  it('answers an un-mentioned reply in a thread it has a live session for', async () => {
    const b = bridge();
    b.conversations.set('chan-1|root-1', { sessionId: 's', started: true, queue: [], running: false });
    const msg = message({ id: 'msg-2', threadRootId: 'root-1', body: 'no mention here' });
    expect(await b.inScope(msg)).toBe(true);
  });

  it('answers an un-mentioned reply in a thread it spoke in before a restart', async () => {
    const b = bridge();
    // no live session — the verdict has to come from the thread itself
    b.api.listThread = async () => [
      message({ id: 'root-1', userId: HUMAN }),
      message({ id: 'r-1', userId: AGENT, threadRootId: 'root-1' }),
    ];
    expect(await b.inScope(message({ id: 'm', threadRootId: 'root-1', body: 'plain' }))).toBe(true);
  });

  it('ignores an un-mentioned reply in a thread it never spoke in', async () => {
    const b = bridge();
    b.api.listThread = async () => [
      message({ id: 'root-1', userId: HUMAN }),
      message({ id: 'r-1', userId: HUMAN, threadRootId: 'root-1' }),
    ];
    expect(await b.inScope(message({ id: 'm', threadRootId: 'root-1', body: 'plain' }))).toBe(false);
  });

  it('does not count a deleted message of ours as participation', async () => {
    const b = bridge();
    b.api.listThread = async () => [
      message({ id: 'root-1', userId: HUMAN }),
      message({ id: 'r-1', userId: AGENT, threadRootId: 'root-1', deletedAt: '2026-07-22T00:01:00Z' }),
    ];
    expect(await b.inScope(message({ id: 'm', threadRootId: 'root-1', body: 'plain' }))).toBe(false);
  });

  it('counts being the thread root author as being in the thread', async () => {
    const b = bridge();
    b.api.listThread = async () => [message({ id: 'root-1', userId: AGENT })];
    expect(await b.inScope(message({ id: 'm', threadRootId: 'root-1', body: 'plain' }))).toBe(true);
  });

  it('caches the verdict — one thread lookup, not one per reply', async () => {
    const b = bridge();
    let calls = 0;
    b.api.listThread = async () => {
      calls += 1;
      return [message({ id: 'root-1', userId: HUMAN })];
    };
    await b.inScope(message({ id: 'm1', threadRootId: 'root-1', body: 'a' }));
    await b.inScope(message({ id: 'm2', threadRootId: 'root-1', body: 'b' }));
    expect(calls).toBe(1);
  });

  it('stays quiet (and does not cache) when the thread lookup fails', async () => {
    const b = bridge();
    let calls = 0;
    b.api.listThread = async () => {
      calls += 1;
      throw new Error('boom');
    };
    expect(await b.inScope(message({ id: 'm1', threadRootId: 'root-1', body: 'a' }))).toBe(false);
    await b.inScope(message({ id: 'm2', threadRootId: 'root-1', body: 'b' }));
    expect(calls).toBe(2); // retried rather than remembering a transient failure
  });

  it('still answers a direct @-mention in a thread it is not in', async () => {
    const b = bridge();
    b.api.listThread = async () => [message({ id: 'root-1', userId: HUMAN })];
    const msg = message({ id: 'm', threadRootId: 'root-1', body: `hey <@${AGENT}>` });
    expect(await b.inScope(msg)).toBe(true);
  });

  it('never answers its own thread replies', async () => {
    const b = bridge();
    b.conversations.set('chan-1|root-1', { sessionId: 's', started: true, queue: [], running: false });
    expect(await b.inScope(message({ userId: AGENT, threadRootId: 'root-1' }))).toBe(false);
  });

  it('keeps the agent-to-agent loop guard inside threads', async () => {
    const b = bridge();
    b.conversations.set('chan-1|root-1', { sessionId: 's', started: true, queue: [], running: false });
    expect(await b.inScope(message({ userId: OTHER_AGENT, threadRootId: 'root-1' }))).toBe(false);
  });
});

describe('failureReply', () => {
  it('posts salvaged work alongside the error, not just the error', () => {
    const out = failureReply({ ok: false, text: 'Fixed the reconnect path.', error: 'no output for 120s' });
    expect(out).toContain('no output for 120s');
    expect(out).toContain('Where I got to:');
    expect(out).toContain('Fixed the reconnect path.');
  });

  it('stays a bare apology when there is nothing to salvage', () => {
    const out = failureReply({ ok: false, text: '  ', error: 'boom' });
    expect(out).toBe('🤖 sorry — I hit an error (boom).');
  });

  it('caps salvage so the reply cannot exceed the API body limit', () => {
    const out = failureReply({ ok: false, text: 'x'.repeat(20000), error: 'boom' });
    expect(out.length).toBeLessThan(12000);
    expect(out.endsWith('…')).toBe(true);
  });
});
