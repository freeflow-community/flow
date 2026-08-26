// The `/model` command (per-conversation and per-turn model override).
//
// Under test:
//   1. Bare `/model` reports the model in effect (pin > config > CLI default).
//   2. `/model <name>` pins the model for the conversation.
//   3. `/model <name> <prompt>` runs one turn on <name> — the pin and the
//      config default are untouched.
//   4. `/model default` clears the pin.
//   5. A bad name gets usage help, and queues nothing.
import { describe, expect, it, vi } from 'vitest';
import type { ChannelDTO, MessageDTO } from '@flow/shared';
import { AgentBridge } from '../src/bridge.js';
import type { BridgeConfig } from '../src/config.js';
import type { RuntimeConfig } from '../src/config.js';

const AGENT = 'aaaaaaaa-0000-0000-0000-000000000001';
const HUMAN = 'bbbbbbbb-0000-0000-0000-000000000002';

function config(over: Partial<RuntimeConfig> = {}): BridgeConfig {
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
      ...over,
    } as RuntimeConfig,
    eventScope: 'mentions',
    respondToAgents: false,
    agentMentionsOnly: false,
    agentChainLimit: 6,
    concurrency: 1,
    progress: 'silent',
    relayText: true,
  };
}

function channel(): ChannelDTO {
  return {
    id: 'chan-1',
    workspaceId: 'ws-1',
    name: 'general',
    kind: 'standard',
    topic: null,
    isPrivate: false,
    createdBy: AGENT, // owned channel: top-level messages are in scope and share one session
    createdAt: '2026-08-25T00:00:00Z',
    archivedAt: null,
    isMember: true,
    lastReadMsgId: null,
    unreadCount: 0,
    notifyLevel: 2,
  } as ChannelDTO;
}

function message(over: Partial<MessageDTO> = {}): MessageDTO {
  return {
    id: 'msg-1',
    channelId: 'chan-1',
    userId: HUMAN,
    threadRootId: null,
    clientMsgId: 'c-1',
    body: '/model',
    createdAt: '2026-08-25T00:00:00Z',
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

const KEY = 'chan-1|'; // owned channel → top-level convKey

/** A bridge with post-`start()` state stubbed in — no network, no socket. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bridge(cfg = config()): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = new AgentBridge(cfg) as any;
  b.me = { id: AGENT, isAgent: true, displayName: 'Omni' };
  b.workspace = { id: 'ws-1', name: 'QA Lab' };
  b.channels = new Map([[channel().id, channel()]]);
  b.members = new Map([[HUMAN, { userId: HUMAN, displayName: 'Alice', isAgent: false }]]);
  b.log = () => {};
  b.api = { sendMessage: vi.fn(async () => message()) };
  b.refreshDirectory = async () => {};
  // Keep queued turns inspectable instead of letting the pump consume them.
  b.runConversation = async () => {};
  return b;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lastReply(b: any): string {
  const calls = b.api.sendMessage.mock.calls;
  return calls[calls.length - 1][1] as string;
}

describe('/model — inspect', () => {
  it('reports the CLI default when nothing is configured', async () => {
    const b = bridge();
    await b.handleMessage(message());
    expect(lastReply(b)).toContain('the CLI default');
  });

  it('reports the configured default', async () => {
    const b = bridge(config({ model: 'sonnet' }));
    await b.handleMessage(message());
    expect(lastReply(b)).toContain('sonnet (configured default)');
  });

  it('reports a conversation pin over the configured default', async () => {
    const b = bridge(config({ model: 'sonnet' }));
    await b.handleMessage(message({ id: 'm-1', body: '/model opus' }));
    await b.handleMessage(message({ id: 'm-2', body: '/model' }));
    expect(lastReply(b)).toContain('opus');
    expect(lastReply(b)).toContain('set for this conversation');
  });
});

describe('/model <name> — sticky pin', () => {
  it('pins the model for the conversation and queues no turn', async () => {
    const b = bridge();
    await b.handleMessage(message({ body: '/model opus' }));
    const conv = b.conversations.get(KEY);
    expect(conv.model).toBe('opus');
    expect(conv.queue).toHaveLength(0);
    expect(lastReply(b)).toContain('model set to opus');
  });

  it('works with a leading mention, as channel commands do', async () => {
    const b = bridge();
    await b.handleMessage(message({ body: `<@${AGENT}> /model haiku` }));
    expect(b.conversations.get(KEY).model).toBe('haiku');
  });

  it('/model default clears the pin', async () => {
    const b = bridge();
    await b.handleMessage(message({ id: 'm-1', body: '/model opus' }));
    await b.handleMessage(message({ id: 'm-2', body: '/model default' }));
    expect(b.conversations.get(KEY).model).toBeUndefined();
    expect(lastReply(b)).toContain('cleared');
  });
});

describe('/model <name> <prompt> — one turn', () => {
  it('queues the prompt with a one-turn override, without pinning', async () => {
    const b = bridge();
    await b.handleMessage(message({ body: '/model opus fix the flaky test' }));
    const conv = b.conversations.get(KEY);
    expect(conv.model).toBeUndefined();
    expect(conv.queue).toHaveLength(1);
    expect(conv.queue[0].model).toBe('opus');
    expect(conv.queue[0].msg.body).toBe('fix the flaky test');
  });

  it('leaves an existing pin in place for later turns', async () => {
    const b = bridge();
    await b.handleMessage(message({ id: 'm-1', body: '/model sonnet' }));
    await b.handleMessage(message({ id: 'm-2', body: '/model opus just this once' }));
    const conv = b.conversations.get(KEY);
    expect(conv.model).toBe('sonnet');
    expect(conv.queue[0].model).toBe('opus');
  });

  it('/model default <prompt> clears the pin and runs on the default', async () => {
    const b = bridge();
    await b.handleMessage(message({ id: 'm-1', body: '/model opus' }));
    await b.handleMessage(message({ id: 'm-2', body: '/model default carry on' }));
    const conv = b.conversations.get(KEY);
    expect(conv.model).toBeUndefined();
    expect(conv.queue).toHaveLength(1);
    expect(conv.queue[0].model).toBeUndefined();
    expect(conv.queue[0].msg.body).toBe('carry on');
  });
});

describe('/model — bad input', () => {
  it('an invalid name gets usage help and queues nothing', async () => {
    const b = bridge();
    await b.handleMessage(message({ body: '/model $(rm -rf /)' }));
    expect(lastReply(b)).toContain('usage');
    expect(b.conversations.get(KEY)?.queue ?? []).toHaveLength(0);
  });

  it('an ordinary message is not mistaken for the command', async () => {
    const b = bridge();
    await b.handleMessage(message({ body: '/modeling question' }));
    const conv = b.conversations.get(KEY);
    expect(conv.queue).toHaveLength(1);
    expect(conv.queue[0].msg.body).toBe('/modeling question');
    expect(conv.queue[0].model).toBeUndefined();
  });
});
