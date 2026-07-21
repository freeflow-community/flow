import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEMO_REPLY, StreamJsonParser, buildClaudeArgs, formatToolStep, runRuntime } from '../src/runtime.js';
import type { RuntimeConfig } from '../src/config.js';
import { expandHome, loadConfig } from '../src/config.js';

describe('StreamJsonParser', () => {
  it('collects tool steps and the final result across chunk boundaries', () => {
    const steps: string[] = [];
    const p = new StreamJsonParser((s) => steps.push(s));
    const line1 = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } }] },
    });
    const line2 = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'thinking' }, { type: 'tool_use', name: 'Read', input: { file_path: '/a/b/c.ts' } }] },
    });
    const line3 = JSON.stringify({ type: 'result', subtype: 'success', result: 'all done', is_error: false });
    const raw = `${line1}\n${line2}\n${line3}\n`;
    // feed in awkward chunks
    p.feed(raw.slice(0, 20));
    p.feed(raw.slice(20, 21));
    p.feed(raw.slice(21));
    expect(steps).toEqual(['Bash: pnpm test', 'Read: c.ts']);
    expect(p.sawResult).toBe(true);
    expect(p.isError).toBe(false);
    expect(p.finalText).toBe('all done');
  });

  it('ignores non-JSON noise and flags error results', () => {
    const p = new StreamJsonParser(() => {});
    p.feed('not json at all\n');
    p.feed(`${JSON.stringify({ type: 'result', subtype: 'error_max_turns', result: 'ran out' })}\n`);
    expect(p.sawResult).toBe(true);
    expect(p.isError).toBe(true);
    expect(p.finalText).toBe('ran out');
  });
});

describe('formatToolStep', () => {
  it('formats common tools one-line', () => {
    expect(formatToolStep('Bash', { command: 'ls   -la' })).toBe('Bash: ls -la');
    expect(formatToolStep('Grep', { pattern: 'foo.*bar' })).toBe('Grep: foo.*bar');
    expect(formatToolStep('mcp__flow__send_message', {})).toBe('Flow: send_message');
    expect(formatToolStep('SomethingNew', {})).toBe('SomethingNew');
    const long = 'x'.repeat(200);
    expect(formatToolStep('Bash', { command: long }).length).toBeLessThanOrEqual('Bash: '.length + 80);
  });
});

describe('buildClaudeArgs permissions', () => {
  const base: RuntimeConfig = {
    kind: 'claude', command: 'claude', extraArgs: [], cwd: '/tmp',
    permissionMode: undefined, allowedTools: [], maxTurns: 100, timeoutSec: 300,
    mcp: false, systemPromptExtra: undefined,
  };
  const opts = { sessionId: 's', resume: false, prompt: 'p', systemPrompt: '', onToolStep: () => {}, log: () => {} };

  it('defaults to bypassPermissions (allow everything)', () => {
    const args = buildClaudeArgs(base, opts);
    expect(args.join(' ')).toContain('--permission-mode bypassPermissions');
    expect(args.join(' ')).not.toContain('--allowedTools');
  });

  it('allowedTools opts into scoped permissions (no bypass)', () => {
    const args = buildClaudeArgs({ ...base, allowedTools: ['Read'] }, opts);
    expect(args.join(' ')).not.toContain('bypassPermissions');
    expect(args.join(' ')).toContain('--allowedTools=Read');
  });

  it('explicit permissionMode always wins', () => {
    const args = buildClaudeArgs({ ...base, permissionMode: 'acceptEdits' }, opts);
    expect(args.join(' ')).toContain('--permission-mode acceptEdits');
    expect(args.join(' ')).not.toContain('bypassPermissions');
  });

  it('runtime.model passes --model; unset omits it', () => {
    expect(buildClaudeArgs({ ...base, model: 'opus' }, opts).join(' ')).toContain('--model opus');
    expect(buildClaudeArgs(base, opts).join(' ')).not.toContain('--model');
  });
});

describe('loadConfig', () => {
  it('applies defaults and resolves cwd relative to the config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-cfg-'));
    const p = path.join(dir, 'agent.json');
    fs.mkdirSync(path.join(dir, 'work'));
    fs.writeFileSync(
      p,
      JSON.stringify({ serverUrl: 'http://127.0.0.1:8787/', agentToken: 'flow-agent-token-x', runtime: { cwd: 'work' } }),
    );
    const cfg = loadConfig(p);
    expect(cfg.serverUrl).toBe('http://127.0.0.1:8787'); // trailing slash stripped
    expect(cfg.runtime.kind).toBe('claude');
    expect(cfg.runtime.command).toBe('claude');
    expect(cfg.runtime.cwd).toBe(path.join(dir, 'work'));
    expect(cfg.eventScope).toBe('mentions');
    expect(cfg.progress).toBe('thinking');
    expect(cfg.respondToAgents).toBe(false);
    expect(cfg.concurrency).toBe(4);
    expect(cfg.runtime.mcp).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accepts the demo runtime (no CLI, MCP off)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-cfg-'));
    const p = path.join(dir, 'agent.json');
    fs.writeFileSync(
      p,
      JSON.stringify({ serverUrl: 'http://x', agentToken: 't', runtime: { kind: 'demo' } }),
    );
    const cfg = loadConfig(p);
    expect(cfg.runtime.kind).toBe('demo');
    expect(cfg.runtime.mcp).toBe(false);
    const res = await runRuntime(cfg.runtime, {
      sessionId: 's',
      resume: false,
      prompt: 'hello',
      systemPrompt: '',
      onToolStep: () => {},
      log: () => {},
    });
    expect(res).toEqual({ ok: true, text: DEMO_REPLY });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('defaults logFile to <config>.log; null disables; paths resolve + expand', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-cfg-'));
    const p = path.join(dir, 'agent.json');
    const base = { serverUrl: 'http://x', agentToken: 't', runtime: { kind: 'demo' } };
    fs.writeFileSync(p, JSON.stringify(base));
    expect(loadConfig(p).logFile).toBe(path.join(dir, 'agent.log'));
    fs.writeFileSync(p, JSON.stringify({ ...base, logFile: null }));
    expect(loadConfig(p).logFile).toBeNull();
    fs.writeFileSync(p, JSON.stringify({ ...base, logFile: 'logs/x.log' }));
    expect(loadConfig(p).logFile).toBe(path.join(dir, 'logs/x.log'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('expands ~ in cwd and rejects a nonexistent cwd for spawning runtimes', () => {
    expect(expandHome('~')).toBe(os.homedir());
    expect(expandHome('~/projects')).toBe(path.join(os.homedir(), 'projects'));
    expect(expandHome('/abs/path')).toBe('/abs/path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-cfg-'));
    const p = path.join(dir, 'agent.json');
    fs.writeFileSync(
      p,
      JSON.stringify({ serverUrl: 'http://x', agentToken: 't', runtime: { cwd: '/does/not/exist-xyz' } }),
    );
    expect(() => loadConfig(p)).toThrow(/cwd does not exist/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects bad values', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-cfg-'));
    const p = path.join(dir, 'agent.json');
    fs.writeFileSync(p, JSON.stringify({ serverUrl: 'http://x', agentToken: 't', eventScope: 'sometimes' }));
    expect(() => loadConfig(p)).toThrow(/eventScope/);
    fs.writeFileSync(p, JSON.stringify({ agentToken: 't' }));
    delete process.env.FLOW_SERVER_URL;
    expect(() => loadConfig(p)).toThrow(/serverUrl/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
