import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const dirs: string[] = [];

function configFile(voice?: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-voice-config-'));
  dirs.push(dir);
  const file = path.join(dir, 'agent.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      serverUrl: 'http://127.0.0.1:8787',
      agentToken: 'flow-agent-token-test',
      runtime: { kind: 'demo' },
      ...(voice ? { voice } : {}),
    }),
  );
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('voice configuration', () => {
  it('is enabled by default for existing agent.json files', () => {
    const cfg = loadConfig(configFile());
    expect(cfg.voice).toMatchObject({ enabled: true, voice: 'marin', maxSessionMinutes: 60 });
    expect(cfg.voice?.model).toBeTruthy();
  });

  it('reads explicit model, voice, duration, and instructions', () => {
    const cfg = loadConfig(
      configFile({
        enabled: false,
        model: ' custom-realtime ',
        voice: ' coral ',
        maxSessionMinutes: 25,
        instructions: ' Be upbeat. ',
      }),
    );
    expect(cfg.voice).toEqual({
      enabled: false,
      model: 'custom-realtime',
      voice: 'coral',
      maxSessionMinutes: 25,
      instructions: 'Be upbeat.',
    });
  });

  it('rejects a non-positive session duration', () => {
    expect(() => loadConfig(configFile({ maxSessionMinutes: 0 }))).toThrow(/positive number/);
  });
});
