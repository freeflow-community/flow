import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEMO_REPLY,
  StreamJsonParser,
  buildClaudeArgs,
  describeResultError,
  formatToolStep,
  runRuntime,
} from '../src/runtime.js';
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
    expect(p.sawEvent).toBe(true);
    expect(p.lastText).toBe('thinking'); // salvage for a run that never reaches a result
  });

  it('keeps the newest assistant text and ignores empty blocks', () => {
    const p = new StreamJsonParser(() => {});
    const say = (text: string): string =>
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
    p.feed(`${say('first pass')}\n${say('   ')}\n${say('second pass')}\n`);
    expect(p.lastText).toBe('second pass');
    expect(p.sawResult).toBe(false); // no result event — but the session exists
    expect(p.sawEvent).toBe(true);
  });

  it('does not mistake non-JSON noise for a live session', () => {
    const p = new StreamJsonParser(() => {});
    p.feed('claude: command not found\n');
    expect(p.sawEvent).toBe(false);
  });

  it('ignores non-JSON noise and flags error results', () => {
    const p = new StreamJsonParser(() => {});
    p.feed('not json at all\n');
    p.feed(`${JSON.stringify({ type: 'result', subtype: 'error_max_turns', result: 'ran out' })}\n`);
    expect(p.sawResult).toBe(true);
    expect(p.isError).toBe(true);
    expect(p.errorSubtype).toBe('error_max_turns');
    expect(p.finalText).toBe('ran out');
  });

  it('keeps no subtype for a successful result', () => {
    const p = new StreamJsonParser(() => {});
    p.feed(`${JSON.stringify({ type: 'result', subtype: 'success', result: 'fine', is_error: false })}\n`);
    expect(p.errorSubtype).toBe('');
  });

  // #162: the text blocks used to be parsed and dropped, so every normal turn
  // discarded the agent's running commentary.
  it('emits every assistant text block as it arrives', () => {
    const said: string[] = [];
    const p = new StreamJsonParser(
      () => {},
      (t) => said.push(t),
    );
    const say = (text: string): string =>
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
    p.feed(`${say('  reading the parser  ')}\n${say('')}\n${say('now writing the test')}\n`);
    expect(said).toEqual(['reading the parser', 'now writing the test']);
  });

  it('emits text in the order it appears alongside tool calls', () => {
    const events: string[] = [];
    const p = new StreamJsonParser(
      (s) => events.push(`step:${s}`),
      (t) => events.push(`text:${t}`),
    );
    p.feed(
      `${JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'let me check the tests' },
            { type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } },
          ],
        },
      })}\n`,
    );
    expect(events).toEqual(['text:let me check the tests', 'step:Bash: pnpm test']);
  });

  it('swallows a block identical to the one before it', () => {
    // Relaying the same sentence twice reads as a glitch, not as progress.
    const said: string[] = [];
    const p = new StreamJsonParser(
      () => {},
      (t) => said.push(t),
    );
    const say = (text: string): string =>
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
    p.feed(`${say('on it')}\n${say('on it')}\n${say('still on it')}\n`);
    expect(said).toEqual(['on it', 'still on it']);
    expect(p.lastText).toBe('still on it');
  });

  it('needs no text callback — the salvage path still works', () => {
    const p = new StreamJsonParser(() => {});
    p.feed(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'got here' }] } })}\n`);
    expect(p.lastText).toBe('got here');
  });
});

describe('describeResultError', () => {
  // The turn cap is the common failure and the one an operator can fix, so it
  // has to be nameable from the chat message alone.
  it('names the turn cap and carries its value', () => {
    expect(describeResultError('error_max_turns', 200)).toBe('agent exceeded max turns (200)');
  });

  it('passes any other subtype through rather than swallowing it', () => {
    expect(describeResultError('error_during_execution', 200)).toBe('runtime reported error_during_execution');
  });

  it('falls back when the runtime flagged an error with no subtype', () => {
    expect(describeResultError('', 200)).toBe('runtime reported an error');
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
    permissionMode: undefined, allowedTools: [], maxTurns: 100, timeoutSec: 300, idleTimeoutSec: 120,
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

// A run ends when it goes quiet, not when it gets long: these drive real
// spawns through fake runtime scripts, so the timers, the process-group kill
// and the stdout rearm are all exercised for real.
describe('run expiry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-runtime-'));
  const TICK = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"tick"}}]}}';
  const DONE = '{"type":"result","subtype":"success","result":"done","is_error":false}';

  /** A fake `claude` — it ignores the CLI flags buildClaudeArgs passes it. */
  function script(name: string, body: string): string {
    const p = path.join(dir, `${name}.sh`);
    fs.writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return p;
  }
  function cfg(command: string, over: Partial<RuntimeConfig> = {}): RuntimeConfig {
    return {
      kind: 'claude', command, extraArgs: [], cwd: dir, permissionMode: undefined,
      allowedTools: [], maxTurns: 10, timeoutSec: 30, idleTimeoutSec: 0.4,
      mcp: false, systemPromptExtra: undefined, ...over,
    };
  }
  const run = (c: RuntimeConfig): ReturnType<typeof runRuntime> =>
    runRuntime(c, { sessionId: 's', resume: false, prompt: 'p', systemPrompt: '', onToolStep: () => {}, log: () => {} });

  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  // The whole point of the subtype: the reply has to name the cap, and the cap
  // it names has to be the one this run was actually given.
  it('reports a turn-cap failure by name, with the run’s own cap', async () => {
    const capped = '{"type":"result","subtype":"error_max_turns","result":"Now a unit test:","is_error":true}';
    const res = await run(cfg(script('capped', `echo '${TICK}'; echo '${capped}'`), { maxTurns: 200 }));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('agent exceeded max turns (200)');
    expect(res.text).toBe('Now a unit test:'); // partial work still rides along as salvage
  });

  it('kills a run that goes silent', async () => {
    const res = await run(cfg(script('silent', 'sleep 30')));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no output for 0.4s');
  });

  it('lets a chatty run outlive the idle window — output rearms it', async () => {
    // 12 ticks × 100ms ≈ 1.2s of work under a 0.4s idle window: a fixed
    // wall-clock timeout of the same length would have killed this.
    const p = script('chatty', `i=0\nwhile [ $i -lt 12 ]; do\n  echo '${TICK}'\n  sleep 0.1\n  i=$((i+1))\ndone\necho '${DONE}'`);
    const res = await run(cfg(p));
    expect(res).toMatchObject({ ok: true, text: 'done', sawSession: true });
  });

  it('salvages the last thing the agent said, and reports the session as resumable', () => {
    // The regression: hours of work vanished into an error string because the
    // terminal result event never arrives for a killed run.
    const say = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Found the leak in the WS reconnect path.' }] },
    }).replace(/'/g, `'\\''`);
    const p = script('salvage', `echo '${say}'\nsleep 30`);
    return run(cfg(p)).then((res) => {
      expect(res.ok).toBe(false);
      expect(res.error).toBe('no output for 0.4s');
      expect(res.text).toBe('Found the leak in the WS reconnect path.');
      expect(res.sawSession).toBe(true); // → the bridge keeps the session id
    });
  });

  it('reports no session when the CLI dies before emitting anything', async () => {
    const res = await run(cfg(script('stillborn', 'echo "boom" >&2\nexit 1')));
    expect(res.ok).toBe(false);
    expect(res.sawSession).toBe(false); // → the bridge rerolls to a fresh id
    expect(res.text).toBe('');
  });

  it('still enforces the absolute run cap on a runaway', async () => {
    const p = script('forever', `while true; do\n  echo '${TICK}'\n  sleep 0.1\ndone`);
    const res = await run(cfg(p, { idleTimeoutSec: 30, timeoutSec: 0.5 }));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('hit the 0.5s run cap');
  });

  it('takes the whole process group down, not just the CLI', async () => {
    // The regression: a bare child.kill() left Bash-tool grandchildren (builds,
    // test runs, dev servers) orphaned and running after the turn was killed.
    const pidFile = path.join(dir, 'grandchild.pid');
    const p = script('grandchild', `sleep 60 &\necho $! > ${pidFile}\necho starting\nsleep 60`);
    const res = await run(cfg(p));
    expect(res.ok).toBe(false);
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    expect(pid).toBeGreaterThan(0);
    for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50));
    expect(alive(pid)).toBe(false);
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
    expect(cfg.runtime.maxTurns).toBe(200); // a runaway backstop, not a work limit
    expect(cfg.runtime.idleTimeoutSec).toBe(120);
    expect(cfg.runtime.timeoutSec).toBe(3600); // backstop only — idle is the real limit
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a non-positive timeout (it would expire every run instantly)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-cfg-'));
    const p = path.join(dir, 'agent.json');
    const base = { serverUrl: 'http://x', agentToken: 't', runtime: { kind: 'demo' } };
    fs.writeFileSync(p, JSON.stringify({ ...base, runtime: { kind: 'demo', idleTimeoutSec: 0 } }));
    expect(() => loadConfig(p)).toThrow(/idleTimeoutSec must be a positive number/);
    fs.writeFileSync(p, JSON.stringify({ ...base, runtime: { kind: 'demo', timeoutSec: -1 } }));
    expect(() => loadConfig(p)).toThrow(/timeoutSec must be a positive number/);
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
