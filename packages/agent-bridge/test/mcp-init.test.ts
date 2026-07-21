import { describe, expect, it } from 'vitest';
import { buildFlowServerEntry, mergeMcpJson } from '../src/mcp-init.js';

describe('buildFlowServerEntry', () => {
  it('carries server/token/workspace env and pins no channel', () => {
    const entry = buildFlowServerEntry({
      serverUrl: 'https://app.flowtoo.org',
      agentToken: 'flow-agent-token-x',
      workspaceId: 'ws-1',
      command: 'flow-agent-bridge',
      args: ['mcp'],
    });
    expect(entry).toEqual({
      command: 'flow-agent-bridge',
      args: ['mcp'],
      env: {
        FLOW_SERVER_URL: 'https://app.flowtoo.org',
        FLOW_AGENT_TOKEN: 'flow-agent-token-x',
        FLOW_WORKSPACE_ID: 'ws-1',
      },
    });
  });
});

describe('mergeMcpJson', () => {
  const flow = { command: 'flow-agent-bridge', args: ['mcp'], env: { FLOW_AGENT_TOKEN: 'tok' } };

  it('creates a fresh doc', () => {
    const { json, replaced } = mergeMcpJson(undefined, flow);
    expect(replaced).toBe(false);
    expect(JSON.parse(json)).toEqual({ mcpServers: { flow } });
  });

  it('preserves other servers and replaces an existing flow entry', () => {
    const existing = JSON.stringify({
      mcpServers: {
        flow: { command: 'stale' },
        other: { command: 'other-server', args: [] },
      },
    });
    const { json, replaced } = mergeMcpJson(existing, flow);
    expect(replaced).toBe(true);
    expect(JSON.parse(json)).toEqual({ mcpServers: { flow, other: { command: 'other-server', args: [] } } });
  });

  it('tolerates a doc without mcpServers', () => {
    const { json, replaced } = mergeMcpJson('{}', flow);
    expect(replaced).toBe(false);
    expect(JSON.parse(json)).toEqual({ mcpServers: { flow } });
  });

  it('refuses to clobber invalid JSON', () => {
    expect(() => mergeMcpJson('{ not json', flow)).toThrow(/isn't valid JSON/);
  });
});
