// Presence registry (#364): per-(user, workspace) scoping, multi-connection
// counting, and the TTL backstop. Pure in-memory state — no database needed.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addWorkspace,
  hasAnyConnection,
  isOnline,
  onlineUsersIn,
  registerConnection,
  removeWorkspace,
  resetPresence,
  sweepStale,
  touchConnection,
  unregisterConnection,
} from '../src/presence.js';

const AGENT = 'user-agent';
const HUMAN = 'user-human';
const WS_A = 'ws-locked-in';
const WS_B = 'ws-home-team';

beforeEach(() => resetPresence());

describe('presence scoping', () => {
  it('lights only the workspaces a connection declares', () => {
    // the bug in #364: the bridge belongs to both workspaces but serves one
    const came = registerConnection('c1', AGENT, [WS_A]);
    expect(came).toEqual([WS_A]);
    expect(isOnline(AGENT, WS_A)).toBe(true);
    expect(isOnline(AGENT, WS_B)).toBe(false);
    expect(onlineUsersIn(WS_A)).toEqual([AGENT]);
    expect(onlineUsersIn(WS_B)).toEqual([]);
  });

  it('a multi-workspace connection lights all of them (human client)', () => {
    expect(registerConnection('c1', HUMAN, [WS_A, WS_B]).sort()).toEqual([WS_B, WS_A].sort());
    expect(isOnline(HUMAN, WS_A)).toBe(true);
    expect(isOnline(HUMAN, WS_B)).toBe(true);
  });

  it('keeps workspaces independent across users', () => {
    registerConnection('c1', AGENT, [WS_A]);
    registerConnection('c2', HUMAN, [WS_B]);
    expect(onlineUsersIn(WS_A)).toEqual([AGENT]);
    expect(onlineUsersIn(WS_B)).toEqual([HUMAN]);
  });
});

describe('multiple connections', () => {
  it('stays online while any connection to that workspace is alive', () => {
    expect(registerConnection('c1', AGENT, [WS_A])).toEqual([WS_A]);
    // second connection to the same workspace: no fresh online transition
    expect(registerConnection('c2', AGENT, [WS_A])).toEqual([]);
    expect(unregisterConnection('c1')).toEqual([]);
    expect(isOnline(AGENT, WS_A)).toBe(true);
    expect(unregisterConnection('c2')).toEqual([WS_A]);
    expect(isOnline(AGENT, WS_A)).toBe(false);
    expect(hasAnyConnection(AGENT)).toBe(false);
  });

  it('closing a workspace-A connection leaves workspace B alone', () => {
    registerConnection('c1', AGENT, [WS_A]);
    registerConnection('c2', AGENT, [WS_B]);
    expect(unregisterConnection('c1')).toEqual([WS_A]);
    expect(isOnline(AGENT, WS_A)).toBe(false);
    expect(isOnline(AGENT, WS_B)).toBe(true);
  });

  it('unregistering an unknown connection is a no-op', () => {
    expect(unregisterConnection('nope')).toEqual([]);
  });
});

describe('workspace membership changes mid-connection', () => {
  it('adds presence when the connection joins a workspace live', () => {
    registerConnection('c1', AGENT, [WS_A]);
    expect(addWorkspace('c1', WS_B)).toBe(true);
    expect(isOnline(AGENT, WS_B)).toBe(true);
    expect(addWorkspace('c1', WS_B)).toBe(false); // idempotent
  });

  it('drops presence when the connection leaves a workspace', () => {
    registerConnection('c1', AGENT, [WS_A, WS_B]);
    expect(removeWorkspace('c1', WS_B)).toBe(true);
    expect(isOnline(AGENT, WS_B)).toBe(false);
    expect(isOnline(AGENT, WS_A)).toBe(true);
    expect(removeWorkspace('c1', WS_B)).toBe(false); // idempotent
  });

  it('a left workspace does not come back when the connection closes', () => {
    registerConnection('c1', AGENT, [WS_A, WS_B]);
    removeWorkspace('c1', WS_B);
    expect(unregisterConnection('c1')).toEqual([WS_A]);
  });
});

describe('TTL backstop', () => {
  const TTL = 90_000;

  it('expires a connection that stopped answering', () => {
    registerConnection('c1', AGENT, [WS_A], 1_000);
    expect(sweepStale(TTL, 1_000 + TTL)).toEqual([]); // not yet past the TTL
    const stale = sweepStale(TTL, 1_000 + TTL + 1);
    expect(stale).toEqual([{ connectionId: 'c1', userId: AGENT, wentOffline: [WS_A] }]);
    expect(isOnline(AGENT, WS_A)).toBe(false);
    expect(sweepStale(TTL, 1_000 + TTL + 1)).toEqual([]); // swept once, then gone
  });

  it('a touched connection survives the sweep', () => {
    registerConnection('c1', AGENT, [WS_A], 1_000);
    touchConnection('c1', 1_000 + TTL);
    expect(sweepStale(TTL, 1_000 + TTL + 1)).toEqual([]);
    expect(isOnline(AGENT, WS_A)).toBe(true);
  });

  it('a stale connection does not take a live sibling offline', () => {
    registerConnection('c1', AGENT, [WS_A], 1_000);
    registerConnection('c2', AGENT, [WS_A], 1_000);
    touchConnection('c2', 1_000 + TTL);
    const stale = sweepStale(TTL, 1_000 + TTL + 1);
    expect(stale.map((s) => s.connectionId)).toEqual(['c1']);
    expect(stale[0]!.wentOffline).toEqual([]);
    expect(isOnline(AGENT, WS_A)).toBe(true);
  });
});
