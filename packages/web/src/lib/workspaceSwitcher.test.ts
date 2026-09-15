import { describe, expect, it } from 'vitest';
import { emptyRegistry, type ConnectionRegistry, type ServerConnection, type ServerSession } from './connections';
import { showsSource, switcherEntries } from './workspaceSwitcher';

const connection = (connectionId: string, provider: 'flow' | 'slack', origin: string): ServerConnection => ({
  connectionId, provider, origin, providerIdentity: origin, label: origin, apiVersion: 1, capabilities: {}, addedAt: '2026-09-15T00:00:00Z',
});
const session = (connectionId: string, userId: string, status: ServerSession['status'] = 'authenticated'): ServerSession => ({
  connectionId, userId, status, credentialRef: `flow.${connectionId}.token`, storageKey: connectionId, authGeneration: 0,
});

function registry(): ConnectionRegistry {
  return {
    ...emptyRegistry(),
    connections: [
      connection('home', 'flow', 'https://app.freeflow.im'),
      connection('slack', 'slack', 'https://slack.freeflow.im'),
      connection('other', 'flow', 'https://flow.example.com'),
    ],
    sessions: [session('home', 'u1'), session('slack', 'U1'), session('other', 'u9')],
    bindings: [
      { connectionId: 'home', userId: 'u1', workspaceId: 'stale', name: 'Stale binding' },
      { connectionId: 'slack', userId: 'U1', workspaceId: 'T1', name: 'Coderbots' },
      { connectionId: 'other', userId: 'u9', workspaceId: 'w9', name: 'Partner' },
      { connectionId: 'other', userId: 'u9', workspaceId: 'hid', name: 'Hidden', hidden: true },
    ],
  };
}

describe('switcherEntries', () => {
  it('lists Slack teams and other servers alongside the foreground workspaces', () => {
    const entries = switcherEntries(registry(), 'home', [{ id: 'w1', name: 'Flow Home' }]);
    expect(entries.map(e => [e.name, e.source, e.foreground])).toEqual([
      ['Flow Home', 'app.freeflow.im', true],
      ['Coderbots', 'Slack', false],
      ['Partner', 'flow.example.com', false],
    ]);
  });

  it('uses bindings for the foreground connection until its live list loads', () => {
    const entries = switcherEntries(registry(), 'slack', undefined);
    expect(entries.find(e => e.foreground)?.name).toBe('Coderbots');
    expect(entries.map(e => e.name)).toContain('Stale binding');
  });

  it('leaves out connections that need signing in again', () => {
    const r = registry();
    r.sessions = r.sessions.map(s => s.connectionId === 'other' ? { ...s, status: 'unauthorized' } : s);
    expect(switcherEntries(r, 'home', []).map(e => e.connectionId)).toEqual(['slack']);
  });

  it('carries unread counts from background sync', () => {
    const entries = switcherEntries(registry(), 'home', [], [{ connectionId: 'other', status: 'connected', unreadByWorkspace: { w9: 3 }, unread: 3 }]);
    expect(entries.find(e => e.workspaceId === 'w9')?.unread).toBe(3);
  });

  it('names the source only when workspaces come from more than one connection', () => {
    expect(showsSource(switcherEntries(registry(), 'home', [{ id: 'w1', name: 'A' }]))).toBe(true);
    const single = { ...registry(), connections: registry().connections.slice(0, 1) };
    expect(showsSource(switcherEntries(single, 'home', [{ id: 'w1', name: 'A' }, { id: 'w2', name: 'B' }]))).toBe(false);
  });
});
