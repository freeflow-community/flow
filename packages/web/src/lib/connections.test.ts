import { beforeEach, describe, expect, it } from 'vitest';
import {
  LEGACY_STORAGE_KEY,
  LEGACY_TOKEN_KEY,
  MIGRATION_MARKER_KEY,
  REGISTRY_KEY,
  addFlowConnection,
  bindIdentity,
  credentialRefFor,
  emptyRegistry,
  loadOrMigrateRegistry,
  loadRegistry,
  migrateLegacyState,
  navigationTargetFor,
  removeConnection,
  saveRegistry,
  scopedKey,
  sessionFor,
  setNavigationTarget,
  setWorkspaceBinding,
  updateSession,
} from './connections';

// Vitest runs these in node, which has no localStorage.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

beforeEach(() => store.clear());

const ORIGIN = 'https://flow.example.com';

describe('storage keys', () => {
  it('resolves the legacy namespace to the keys an existing browser already has', () => {
    expect(scopedKey(LEGACY_STORAGE_KEY, 'activeWorkspace')).toBe('flow.activeWorkspace');
    expect(credentialRefFor(LEGACY_STORAGE_KEY)).toBe(LEGACY_TOKEN_KEY);
  });

  it('prefixes every other namespace so two connections cannot collide', () => {
    expect(scopedKey('abc', 'activeWorkspace')).toBe('flow.abc.activeWorkspace');
    expect(credentialRefFor('abc')).toBe('flow.abc.token');
    expect(scopedKey('abc', 'token')).not.toBe(scopedKey('def', 'token'));
  });
});

describe('migrateLegacyState', () => {
  it('adopts the existing token and workspace in place, without copying either', () => {
    store.set(LEGACY_TOKEN_KEY, 'legacy-bearer');
    store.set('flow.activeWorkspace', 'ws-1');

    const registry = migrateLegacyState(ORIGIN);
    const conn = registry.connections[0]!;
    expect(conn.provider).toBe('flow');
    expect(conn.origin).toBe(ORIGIN);
    expect(conn.providerIdentity).toBe(ORIGIN);
    expect(registry.activeConnectionId).toBe(conn.connectionId);

    const session = sessionFor(registry, conn.connectionId)!;
    expect(session.credentialRef).toBe(LEGACY_TOKEN_KEY);
    expect(session.storageKey).toBe(LEGACY_STORAGE_KEY);
    expect(session.status).toBe('authenticated');
    // The token stayed exactly where it was, and nothing was written elsewhere.
    expect(store.get(LEGACY_TOKEN_KEY)).toBe('legacy-bearer');
    expect(JSON.stringify(registry)).not.toContain('legacy-bearer');
    expect(store.get('flow.activeWorkspace')).toBe('ws-1');
  });

  it('does not claim an identity migration has not validated', () => {
    store.set(LEGACY_TOKEN_KEY, 'legacy-bearer');
    store.set('flow.currentUserId', 'user-from-a-previous-build');
    // Adopted, not asserted: `bindIdentity` commits the userId once /v1/me has
    // validated the token this connection inherited.
    expect(migrateLegacyState(ORIGIN).sessions[0]!.userId).toBeNull();
  });

  it('starts signed out when there was no legacy token', () => {
    expect(migrateLegacyState(ORIGIN).sessions[0]!.status).toBe('signed-out');
  });

  it('is idempotent — a second run returns the same connection', () => {
    store.set(LEGACY_TOKEN_KEY, 'legacy-bearer');
    const first = migrateLegacyState(ORIGIN);
    const second = migrateLegacyState(ORIGIN);
    expect(second.connections).toHaveLength(1);
    expect(second.connections[0]!.connectionId).toBe(first.connections[0]!.connectionId);
  });

  it('re-runs cleanly when it was interrupted before the marker landed', () => {
    store.set(LEGACY_TOKEN_KEY, 'legacy-bearer');
    store.set('flow.activeWorkspace', 'ws-1');
    migrateLegacyState(ORIGIN);
    // Crash between committing the registry and writing the marker.
    store.delete(MIGRATION_MARKER_KEY);

    const again = loadOrMigrateRegistry(ORIGIN);
    expect(again.connections).toHaveLength(1);
    expect(sessionFor(again, again.connections[0]!.connectionId)!.credentialRef).toBe(LEGACY_TOKEN_KEY);
    expect(store.get(LEGACY_TOKEN_KEY)).toBe('legacy-bearer');
    expect(store.get('flow.activeWorkspace')).toBe('ws-1');
  });

  it('re-runs cleanly when it was interrupted before the registry landed', () => {
    store.set(LEGACY_TOKEN_KEY, 'legacy-bearer');
    // Crash before anything was written at all: the browser is untouched.
    const registry = loadOrMigrateRegistry(ORIGIN);
    expect(registry.connections).toHaveLength(1);
    expect(registry.sessions[0]!.status).toBe('authenticated');
  });

  it('discards a corrupt or future-versioned registry rather than half-reading it', () => {
    store.set(REGISTRY_KEY, '{not json');
    expect(loadRegistry().connections).toHaveLength(0);
    store.set(REGISTRY_KEY, JSON.stringify({ version: 99, connections: [{}], sessions: [] }));
    expect(loadRegistry().connections).toHaveLength(0);
    store.set(LEGACY_TOKEN_KEY, 'legacy-bearer');
    expect(loadOrMigrateRegistry(ORIGIN).connections).toHaveLength(1);
  });
});

describe('addFlowConnection', () => {
  it('canonicalizes the origin and mints a private namespace', () => {
    const { registry, connection } = addFlowConnection(emptyRegistry(), { origin: 'HTTPS://Flow.Example.com/' });
    expect(connection.origin).toBe(ORIGIN);
    const session = sessionFor(registry, connection.connectionId)!;
    expect(session.storageKey).not.toBe(LEGACY_STORAGE_KEY);
    expect(session.credentialRef).toBe(credentialRefFor(session.storageKey));
    expect(session.authGeneration).toBe(0);
  });

  it('returns the existing connection for an origin already added', () => {
    const first = addFlowConnection(emptyRegistry(), { origin: ORIGIN });
    const second = addFlowConnection(first.registry, { origin: 'https://flow.example.com:443' });
    expect(second.registry.connections).toHaveLength(1);
    expect(second.connection.connectionId).toBe(first.connection.connectionId);
  });

  it('treats a different port as a different server', () => {
    const first = addFlowConnection(emptyRegistry(), { origin: ORIGIN });
    const second = addFlowConnection(first.registry, { origin: 'https://flow.example.com:8443' });
    expect(second.registry.connections).toHaveLength(2);
  });

  it('gives two connections disjoint namespaces even for identical server ids', () => {
    const a = addFlowConnection(emptyRegistry(), { origin: 'https://a.example.com' });
    const b = addFlowConnection(a.registry, { origin: 'https://b.example.com' });
    const [sa, sb] = b.registry.sessions;
    expect(sa!.storageKey).not.toBe(sb!.storageKey);
    expect(scopedKey(sa!.storageKey, 'activeWorkspace')).not.toBe(
      scopedKey(sb!.storageKey, 'activeWorkspace'),
    );
  });
});

describe('bindIdentity', () => {
  it('adopts the first validated identity onto the existing namespace', () => {
    store.set(LEGACY_TOKEN_KEY, 'legacy-bearer');
    const migrated = migrateLegacyState(ORIGIN);
    const id = migrated.connections[0]!.connectionId;
    const { registry, rotatedFrom } = bindIdentity(migrated, id, 'user-1');
    expect(rotatedFrom).toBeNull();
    const session = sessionFor(registry, id)!;
    expect(session.userId).toBe('user-1');
    expect(session.storageKey).toBe(LEGACY_STORAGE_KEY);
    expect(session.status).toBe('authenticated');
  });

  it('rotates the namespace when a different identity signs in', () => {
    const { registry: r0, connection } = addFlowConnection(emptyRegistry(), { origin: ORIGIN });
    const { registry: r1 } = bindIdentity(r0, connection.connectionId, 'user-1');
    const before = sessionFor(r1, connection.connectionId)!.storageKey;
    const { registry: r2, rotatedFrom } = bindIdentity(r1, connection.connectionId, 'user-2');
    const after = sessionFor(r2, connection.connectionId)!;
    expect(rotatedFrom).toBe(before);
    expect(after.storageKey).not.toBe(before);
    expect(after.credentialRef).toBe(credentialRefFor(after.storageKey));
  });

  it('is a no-op for the same identity signing in again', () => {
    const { registry: r0, connection } = addFlowConnection(emptyRegistry(), { origin: ORIGIN });
    const { registry: r1 } = bindIdentity(r0, connection.connectionId, 'user-1');
    const { registry: r2, rotatedFrom } = bindIdentity(r1, connection.connectionId, 'user-1');
    expect(rotatedFrom).toBeNull();
    expect(sessionFor(r2, connection.connectionId)!.storageKey).toBe(
      sessionFor(r1, connection.connectionId)!.storageKey,
    );
  });
});

describe('bindings, navigation and removal', () => {
  it('keeps one binding per connection+identity+workspace', () => {
    const { registry, connection } = addFlowConnection(emptyRegistry(), { origin: ORIGIN });
    const base = { connectionId: connection.connectionId, userId: 'u1', workspaceId: 'ws-1' };
    let r = setWorkspaceBinding(registry, { ...base, name: 'Acme' });
    r = setWorkspaceBinding(r, { ...base, name: 'Acme HQ' });
    expect(r.bindings).toHaveLength(1);
    expect(r.bindings[0]!.name).toBe('Acme HQ');
  });

  it('remembers one navigation target per connection+identity', () => {
    const { registry, connection } = addFlowConnection(emptyRegistry(), { origin: ORIGIN });
    const id = connection.connectionId;
    let r = setNavigationTarget(registry, { connectionId: id, userId: 'u1', workspaceId: 'ws-1', channelId: 'c1' });
    r = setNavigationTarget(r, { connectionId: id, userId: 'u2', workspaceId: 'ws-9', channelId: 'c9' });
    r = setNavigationTarget(r, { connectionId: id, userId: 'u1', workspaceId: 'ws-1', channelId: 'c2' });
    expect(r.navigation).toHaveLength(2);
    expect(navigationTargetFor(r, id, 'u1')!.channelId).toBe('c2');
    expect(navigationTargetFor(r, id, 'u2')!.channelId).toBe('c9');
  });

  it('removing a connection forgets only its own records', () => {
    const a = addFlowConnection(emptyRegistry(), { origin: 'https://a.example.com' });
    const b = addFlowConnection(a.registry, { origin: 'https://b.example.com' });
    let r = setWorkspaceBinding(b.registry, {
      connectionId: a.connection.connectionId, userId: 'u1', workspaceId: 'ws', name: 'A',
    });
    r = setWorkspaceBinding(r, {
      connectionId: b.connection.connectionId, userId: 'u1', workspaceId: 'ws', name: 'B',
    });
    r = { ...r, activeConnectionId: a.connection.connectionId };

    const after = removeConnection(r, a.connection.connectionId);
    expect(after.connections.map((c) => c.connectionId)).toEqual([b.connection.connectionId]);
    expect(after.sessions).toHaveLength(1);
    expect(after.bindings.map((x) => x.name)).toEqual(['B']);
    expect(after.activeConnectionId).toBe(b.connection.connectionId);
  });
});

describe('auth generation', () => {
  it('round-trips through storage', () => {
    const { registry, connection } = addFlowConnection(emptyRegistry(), { origin: ORIGIN });
    saveRegistry(updateSession(registry, connection.connectionId, { authGeneration: 3 }));
    expect(sessionFor(loadRegistry(), connection.connectionId)!.authGeneration).toBe(3);
  });
});
