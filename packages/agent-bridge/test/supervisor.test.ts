// The supervisor loop's decisions, and the /update–/restart command path in
// the bridge that drives it via exit codes.
import { describe, expect, it, vi } from 'vitest';
import type { ChannelDTO, MessageDTO } from '@flow/shared';
import { AgentBridge } from '../src/bridge.js';
import type { BridgeConfig } from '../src/config.js';
import { EXIT_RESTART, EXIT_UPDATE, crashBackoffMs, nextAction, updateTarget } from '../src/supervisor.js';
import { currentVersion } from '../src/version.js';

describe('nextAction — what a child exit means', () => {
  it('a clean exit ends the loop', () => {
    expect(nextAction(0, false)).toBe('exit');
  });

  it('any exit during shutdown ends the loop — no respawn races a Ctrl-C', () => {
    expect(nextAction(EXIT_RESTART, true)).toBe('exit');
    expect(nextAction(1, true)).toBe('exit');
    expect(nextAction(null, true)).toBe('exit');
  });

  it('the update code updates; the restart code and crashes respawn', () => {
    expect(nextAction(EXIT_UPDATE, false)).toBe('update');
    expect(nextAction(EXIT_RESTART, false)).toBe('respawn');
    expect(nextAction(1, false)).toBe('respawn');
    expect(nextAction(null, false)).toBe('respawn'); // killed by signal
  });
});

describe('crashBackoffMs', () => {
  it('escalates and caps', () => {
    expect(crashBackoffMs(1)).toBe(1_000);
    expect(crashBackoffMs(2)).toBe(5_000);
    expect(crashBackoffMs(3)).toBe(15_000);
    expect(crashBackoffMs(4)).toBe(60_000);
    expect(crashBackoffMs(50)).toBe(60_000);
  });
});

describe('updateTarget — how this install updates', () => {
  it('derives the npm prefix from a node_modules install (global, local, npx cache alike)', () => {
    expect(updateTarget('/usr/local/lib/node_modules/flow-agent-bridge')).toEqual({
      mode: 'npm',
      prefix: '/usr/local/lib',
    });
    expect(updateTarget('/Users/x/.npm/_npx/abc123/node_modules/flow-agent-bridge')).toEqual({
      mode: 'npm',
      prefix: '/Users/x/.npm/_npx/abc123',
    });
  });

  it('refuses to npm-install over a source checkout', () => {
    expect(updateTarget('/Users/x/flow/packages/agent-bridge')).toEqual({ mode: 'checkout' });
  });
});

// ---- the chat command path -------------------------------------------------

const AGENT = 'aaaaaaaa-0000-0000-0000-000000000001';
const HUMAN = 'bbbbbbbb-0000-0000-0000-000000000002';

function config(): BridgeConfig {
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
  };
}

function channel(over: Partial<ChannelDTO> = {}): ChannelDTO {
  return {
    id: 'dm-1',
    workspaceId: 'ws-1',
    name: null,
    kind: 'dm',
    topic: null,
    isPrivate: true,
    createdBy: HUMAN,
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
    channelId: 'dm-1',
    userId: HUMAN,
    threadRootId: null,
    clientMsgId: 'c-1',
    body: '/update',
    createdAt: '2026-07-28T00:00:00Z',
    editedAt: null,
    deletedAt: null,
    replyCount: 0,
    lastReplyAt: null,
    replyParticipantUserIds: [],
    reactions: [],
    files: [],
    ...over,
  };
}

/** A bridge with post-`start()` state stubbed in; exit + registry swapped out. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bridge(latest: string | null, chans: ChannelDTO[] = [channel()]): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = new AgentBridge(config()) as any;
  b.me = { id: AGENT, isAgent: true, displayName: 'Omni' };
  b.workspace = { id: 'ws-1', name: 'QA Lab' };
  b.channels = new Map(chans.map((c) => [c.id, c]));
  b.members = new Map([[HUMAN, { userId: HUMAN, displayName: 'Alice', isAgent: false }]]);
  b.log = () => {};
  b.api = { sendMessage: vi.fn(async () => message()) };
  b.enqueue = vi.fn();
  b.stop = vi.fn();
  b.exitProcess = vi.fn();
  b.fetchLatestVersion = vi.fn(async () => latest);
  return b;
}

/** handleRelaunch defers the exit ~300ms; wait for it. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 400));

describe('/update and /restart', () => {
  it('does nothing but say so when already on the latest version', async () => {
    const b = bridge(currentVersion()); // registry says: what we run
    await b.handleMessage(message());
    expect(b.api.sendMessage.mock.calls[0][1]).toMatch(/already running the latest/);
    expect(b.stop).not.toHaveBeenCalled();
    expect(b.exitProcess).not.toHaveBeenCalled();
    expect(b.enqueue).not.toHaveBeenCalled();
  });

  it('acknowledges, stops, and exits with the update code when behind', async () => {
    const b = bridge('999.0.0');
    await b.handleMessage(message());
    await settle();
    expect(b.api.sendMessage.mock.calls[0][1]).toMatch(/updating from v.* and restarting/);
    expect(b.stop).toHaveBeenCalled();
    expect(b.exitProcess).toHaveBeenCalledWith(EXIT_UPDATE);
  });

  it('restarts without consulting the registry', async () => {
    const b = bridge(null);
    await b.handleMessage(message({ body: '/restart' }));
    await settle();
    expect(b.fetchLatestVersion).not.toHaveBeenCalled();
    expect(b.exitProcess).toHaveBeenCalledWith(EXIT_RESTART);
  });

  it('works mention-prefixed in a channel — the mention is what put it in scope', async () => {
    const b = bridge(null, [channel({ id: 'chan-1', kind: 'standard', name: 'general', isPrivate: false })]);
    await b.handleMessage(message({ channelId: 'chan-1', body: `<@${AGENT}> /restart` }));
    await settle();
    expect(b.exitProcess).toHaveBeenCalledWith(EXIT_RESTART);
    expect(b.enqueue).not.toHaveBeenCalled();
  });

  it('leaves ordinary messages alone', async () => {
    const b = bridge(null);
    await b.handleMessage(message({ body: 'please update the readme' }));
    expect(b.enqueue).toHaveBeenCalled();
    expect(b.exitProcess).not.toHaveBeenCalled();
  });
});
