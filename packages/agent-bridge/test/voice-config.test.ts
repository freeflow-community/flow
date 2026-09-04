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
    expect(cfg.voice).toMatchObject({
      enabled: true,
      sttModel: 'deepgram/flux-general-en',
      ttsModel: 'inworld/inworld-tts-2',
      ttsVoice: 'Ashley',
      maxSessionMinutes: 60,
    });
    expect(cfg.voice?.inferenceUrl).toBe('https://agent-gateway.livekit.cloud/v1');
  });

  it('reads explicit speech models, voice, gateway, duration, and instructions', () => {
    const cfg = loadConfig(
      configFile({
        enabled: false,
        sttModel: ' custom-stt ',
        ttsModel: ' custom-tts ',
        ttsVoice: ' custom-voice ',
        inferenceUrl: ' https://inference.example.test/v1 ',
        maxSessionMinutes: 25,
        instructions: ' Be upbeat. ',
      }),
    );
    expect(cfg.voice).toEqual({
      enabled: false,
      sttModel: 'custom-stt',
      ttsModel: 'custom-tts',
      ttsVoice: 'custom-voice',
      inferenceUrl: 'https://inference.example.test/v1',
      maxSessionMinutes: 25,
      instructions: 'Be upbeat.',
    });
  });

  it('rejects a non-positive session duration', () => {
    expect(() => loadConfig(configFile({ maxSessionMinutes: 0 }))).toThrow(/positive number/);
  });
});
