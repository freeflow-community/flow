// How the bridge takes membership changes (#340).
//
// Two cases, and the difference between them is the whole point: somebody
// *else* leaving is a directory refresh, while *we* being removed means every
// workspace-scoped call from here on is a 404. Before this, both went down the
// same path and the second one logged a failed refresh on every event.
import { describe, expect, it } from 'vitest';
import type { Event } from '@flow/shared';
import { AgentBridge } from '../src/bridge.js';
import type { BridgeConfig } from '../src/config.js';

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
    agentMentionsOnly: false,
    agentChainLimit: 6,
    concurrency: 1,
    progress: 'silent',
    relayText: true,
  };
}

/** A bridge with its post-`start()` state stubbed in, and its refresh counted. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bridge(): { b: any; logs: string[]; refreshes: () => number } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = new AgentBridge(config()) as any;
  b.me = { id: AGENT, isAgent: true, displayName: 'Omni' };
  b.workspace = { id: 'ws-1', name: 'QA Lab' };
  b.channels = new Map([['chan-1', { id: 'chan-1', name: 'general' }]]);
  b.members = new Map([[HUMAN, { userId: HUMAN, displayName: 'Alice', isAgent: false }]]);
  const logs: string[] = [];
  b.log = (m: string) => logs.push(m);
  let refreshes = 0;
  b.scheduleRefresh = () => {
    if (b.departed) return; // keep the guard under test
    refreshes += 1;
  };
  return { b, logs, refreshes: () => refreshes };
}

function memberLeft(userId: string, channelId?: string): Event {
  return {
    type: 'member.left',
    workspaceId: 'ws-1',
    ...(channelId ? { channelId } : {}),
    ts: '2026-08-24T00:00:00Z',
    data: { userId, workspaceId: 'ws-1', ...(channelId ? { channelId } : {}) },
  } as Event;
}

describe('member.left', () => {
  it('refreshes the directory when someone else leaves the workspace', () => {
    const { b, refreshes } = bridge();
    b.handleEvent(memberLeft(HUMAN));
    expect(refreshes()).toBe(1);
    expect(b.departed).toBe(false);
  });

  it('keeps serving after another member leaves — the roster just shrinks', () => {
    const { b, logs } = bridge();
    b.handleEvent(memberLeft(HUMAN));
    expect(b.departed).toBe(false);
    expect(logs).toHaveLength(0); // nothing alarming to say
  });

  it('goes quiet when the workspace-level departure is our own', () => {
    const { b, logs, refreshes } = bridge();
    b.handleEvent(memberLeft(AGENT));
    expect(b.departed).toBe(true);
    expect(refreshes()).toBe(0); // no doomed 404 refresh
    expect(logs.join(' ')).toContain('removed from workspace QA Lab');
    expect(b.channels.size).toBe(0);
    expect(b.members.size).toBe(0);
  });

  it('treats losing one channel as a channel change, not a departure', () => {
    // A channel-scoped member.left naming us means we left that channel — the
    // workspace membership is untouched, so the bridge must keep working.
    const { b, refreshes } = bridge();
    b.handleEvent(memberLeft(AGENT, 'chan-1'));
    expect(b.departed).toBe(false);
    expect(refreshes()).toBe(1);
  });

  it('reports its removal once, however many events follow', () => {
    const { b, logs, refreshes } = bridge();
    b.handleEvent(memberLeft(AGENT));
    b.handleEvent(memberLeft(AGENT));
    b.handleEvent(memberLeft(HUMAN));
    b.handleEvent({ type: 'channel.created', workspaceId: 'ws-1', ts: '', data: {} } as Event);
    expect(logs).toHaveLength(1);
    expect(refreshes()).toBe(0);
  });
});
