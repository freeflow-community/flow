// One bridge process serves one workspace (#357). An agent can now belong to
// several, so which one this config means has to be answerable at startup —
// and unanswerable is an error, not a coin flip.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, resolveWorkspace } from '../src/config.js';

const dirs: string[] = [];

function configDir(raw: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-ws-scope-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'agent.json'), JSON.stringify({
    serverUrl: 'http://127.0.0.1:8787',
    agentToken: 'flow-agent-token-x',
    runtime: { kind: 'demo' },
    ...raw,
  }));
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const wsA = { id: 'a', slug: 'acme', name: 'Acme' };
const wsB = { id: 'b', slug: 'globex', name: 'Globex' };

describe('agent.json workspace field', () => {
  it('reads the slug, trimmed', () => {
    expect(loadConfig(path.join(configDir({ workspace: ' acme ' }), 'agent.json')).workspace).toBe('acme');
  });

  it('is null when absent or blank — a single-workspace agent needs no edit', () => {
    expect(loadConfig(path.join(configDir({}), 'agent.json')).workspace).toBeNull();
    expect(loadConfig(path.join(configDir({ workspace: '  ' }), 'agent.json')).workspace).toBeNull();
  });
});

describe('resolveWorkspace', () => {
  it('picks the only workspace whether or not the field is set', () => {
    expect(resolveWorkspace([wsA], null)).toBe(wsA);
    expect(resolveWorkspace([wsA], 'acme')).toBe(wsA);
  });

  it('picks by slug, case-insensitively, when there are several', () => {
    expect(resolveWorkspace([wsA, wsB], 'globex')).toBe(wsB);
    expect(resolveWorkspace([wsA, wsB], 'GLOBEX')).toBe(wsB);
  });

  it('refuses to guess between several and lists the slugs', () => {
    expect(() => resolveWorkspace([wsA, wsB], null)).toThrow(/2 workspaces.*acme, globex/s);
  });

  it('rejects a slug the agent does not belong to, listing what it does', () => {
    expect(() => resolveWorkspace([wsA, wsB], 'initech')).toThrow(/"initech".*available: acme, globex/s);
  });

  it('still reports belonging to nothing', () => {
    expect(() => resolveWorkspace([], null)).toThrow(/no workspace/);
  });
});
