import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { MessageDTO } from '@flow/shared';
import { HuddleVoiceManager } from '../dist/huddle-voice.js';
import { buildClaudeArgs, buildCodexArgs, runRuntime } from '../src/runtime.js';
import type { RuntimeConfig } from '../src/config.js';

const cfg = (kind: 'claude' | 'codex'): RuntimeConfig => ({
  kind, command: process.execPath, extraArgs: [], allowedTools: [], mcp: false,
  cwd: fileURLToPath(new URL('./fixtures/call-runtime/', import.meta.url)),
  maxTurns: 5, timeoutSec: 10, idleTimeoutSec: 5,
});

describe('shared material through a running call', () => {
  it.each(['claude', 'codex'] as const)('keeps new files and replacements in the %s call session', async (kind) => {
    let session: any;
    const calls: any[] = [];
    const spoken = vi.fn();
    const sendMessage = vi.fn();
    const manager = new HuddleVoiceManager({
      agentId: 'agent', agentName: 'Bot', callerName: () => 'Caller',
      config: { enabled: true }, isOneToOneDm: async () => true,
      buildInstructions: async () => 'Read shared materials; speak answers. Do not send messages.',
      api: { acceptHuddleInvite: async () => ({ url: 'wss://unused', token: 'room', inferenceToken: 'speech' }),
        leaveHuddle: async () => {}, declineHuddleInvite: async () => {}, sendMessage,
        downloadCallFile: async (id: string) => Buffer.from(id === 'file1' ? 'Revenue is 12500 dollars.' : 'Revenue is now 18000 dollars.'),
      },
      sessionFactory: async (options: any) => { session = options; return { close: async () => {}, sharedMaterialChanged: spoken }; },
      runTurn: async (turn: any) => {
        const prompt = kind === 'codex' ? turn.transcript : turn.prompt;
        calls.push({ ...turn, prompt });
        return { ok: true, text: 'Reviewed the supplied file.', sawSession: true };
      }, log: () => {},
    });
    try {
      await manager.handleInvite({ invite: { id: 'ring', channelId: 'dm', startedBy: 'caller', status: 'ringing', targets: [{ userId: 'agent', status: 'ringing' }] } });
      const message = (id: string, at: string): MessageDTO => ({
        id: 'message1', userId: 'caller', channelId: 'dm', body: '', createdAt: '2026-09-05T12:00:00.000Z', editedAt: at,
        files: [{ id, name: 'report.txt', mimeType: 'text/plain', sizeBytes: 30 }], systemKind: null,
      } as MessageDTO);
      manager.handleMessage(message('file1', '2026-09-05T12:00:00.000Z'));
      await manager['shared'].context.ready();
      const turn = { prompt: 'What does the file say?', transcript: 'Caller: What does the file say?', signal: new AbortController().signal, onText: vi.fn() };
      await session.runTurn(turn);
      expect(calls[0].prompt).toContain('Revenue is 12500 dollars.');
      manager.handleMessage(message('file2', '2026-09-05T12:01:00.000Z'));
      await manager['shared'].context.ready();
      await session.runTurn({ ...turn, prompt: 'And the updated version?', transcript: 'Caller: What does the file say?\nBot: 12500\nCaller: And the updated version?' });
      expect(calls[1].prompt).toContain('Revenue is now 18000 dollars.');
      expect(calls[1].prompt).not.toContain('Revenue is 12500 dollars.');
      expect(calls[1].sessionId).toBe(calls[0].sessionId);
      expect(calls[1].resume).toBe(true);
      expect(spoken).toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
      const directory = path.dirname(manager['shared'].context.snapshot().text.match(/"localPath":"([^"]+)/)![1].replaceAll('\\\\', '\\'));
      await manager.stop();
      expect(fs.existsSync(directory)).toBe(false);
    } finally { await manager.stop(); }
  });

  it('passes a large call prompt through stdin to a real subprocess', async () => {
    const prompt = 'call context '.repeat(5000);
    const result = await runRuntime(cfg('codex'), { sessionId: 'call', resume: false, prompt,
      systemPrompt: 'system-test', stdinPrompt: true, signal: new AbortController().signal,
      onToolStep: () => {}, log: () => {}, imagePaths: [fileURLToPath(new URL('./fixtures/call-runtime/exec', import.meta.url))],
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.text)).toMatchObject({ length: prompt.length + 'system-test\n\n'.length, imagesExist: true });
  });

  it('keeps call document contents off the argv for both adapters and binds Codex images', () => {
    const opts = { sessionId: 'session', resume: false, prompt: 'private document text', systemPrompt: 'instructions',
      stdinPrompt: true, imagePaths: ['C:\\call files\\page.png'], onToolStep: () => {}, log: () => {} };
    const claude = buildClaudeArgs(cfg('claude'), opts);
    const codex = buildCodexArgs(cfg('codex'), opts);
    expect(claude).not.toContain(opts.prompt);
    expect(codex).not.toContain(opts.prompt);
    expect(codex).toContain('--image=C:\\call files\\page.png');
    expect(codex.slice(-2)).toEqual(['--', '-']);
  });
});
