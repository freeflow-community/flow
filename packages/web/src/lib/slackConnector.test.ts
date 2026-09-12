import { describe, expect, it } from 'vitest';
import { addFlowConnection, addSlackConnection, emptyRegistry, sessionFor } from './connections';
import { slackIdentityKey, type SlackConnection } from './slackConnector';

const connection = (teamId: string, userId = 'U1'): SlackConnection => ({
  identity: { environment: 'slack', enterpriseId: null, teamId, userId }, grantId: `grant-${teamId}`,
  teamName: 'Same name', userName: 'alice', scopes: ['chat:write'], capabilities: { sendAsUser: true }, grantStatus: 'active',
});

describe('Slack connection registry', () => {
  it('keeps two teams at one connector alongside Flow, with separate credential namespaces', () => {
    const flow = addFlowConnection(emptyRegistry(), { origin: 'https://flow.example.com' });
    const a = addSlackConnection(flow.registry, 'https://connector.example.com', connection('T1'));
    const b = addSlackConnection(a.registry, 'https://connector.example.com', connection('T2'));
    expect(b.registry.connections).toHaveLength(3);
    expect(b.registry.activeConnectionId).toBe(flow.connection.connectionId);
    expect(a.connection.providerIdentity).not.toBe(b.connection.providerIdentity);
    expect(sessionFor(b.registry, a.connection.connectionId)?.credentialRef).not.toBe(sessionFor(b.registry, b.connection.connectionId)?.credentialRef);
    // Each team is its own single workspace in the switcher (#545), keyed by
    // the immutable team id and never merged with the other team's binding.
    expect(b.registry.bindings.map(x => [x.connectionId, x.workspaceId])).toEqual([[a.connection.connectionId, 'T1'], [b.connection.connectionId, 'T2']]);
  });
  it('preserves identity on rename, distinguishes users and rejects silent connector migration', () => {
    const first = addSlackConnection(emptyRegistry(), 'https://connector.example.com', connection('T1'));
    const renamed = addSlackConnection(first.registry, 'https://connector.example.com', { ...connection('T1'), teamName: 'Renamed' });
    expect(renamed.connection.connectionId).toBe(first.connection.connectionId);
    expect(renamed.connection.label).toBe('Renamed · alice');
    expect(slackIdentityKey(connection('T1', 'U2').identity)).not.toBe(first.connection.providerIdentity);
    expect(() => addSlackConnection(first.registry, 'https://other.example.com', connection('T1'))).toThrow(/connector/);
  });
});
