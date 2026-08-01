// Runtime exec: spawn a coding-agent CLI headlessly per conversation turn.
//
// Claude runtime (primary): `claude -p --output-format stream-json --verbose`
// with `--session-id <uuid>` on the first turn and `--resume <uuid>` after.
// Tool calls stream by as stream-json events → surfaced as thinking steps.
// Codex runtime: STUB — baseline "prompt in, stdout out" contract, no session
// resume, no thinking steps. Untested; see AGENT_MEMBERS.md.
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { RuntimeConfig } from './config.js';

export interface RunOpts {
  sessionId: string;
  /** false → --session-id (new session); true → --resume. */
  resume: boolean;
  prompt: string;
  systemPrompt: string;
  /** Path to an MCP config JSON to pass via --mcp-config (claude only). */
  mcpConfigPath?: string | undefined;
  /**
   * Abort → end this turn now: the process group dies (SIGTERM first, so the
   * CLI still flushes its session transcript and the next turn can --resume)
   * and the run settles as `interrupted`. This is the Interrupt button.
   */
  signal?: AbortSignal | undefined;
  onToolStep(step: string): void;
  /** Each assistant text block as it is produced — the agent's narration (#162). */
  onText?(text: string): void;
  log(msg: string): void;
}

export interface RunResult {
  ok: boolean;
  /**
   * The reply on success. On failure, whatever could be salvaged — the last
   * thing the agent said before it died, which for an expired run is the only
   * record of the work it did.
   */
  text: string;
  error?: string;
  /**
   * The CLI created a session under this id, so the next turn can `--resume`
   * it with its context even though this turn failed. Any stream-json event
   * proves it: the CLI only starts emitting them once the session exists.
   */
  sawSession?: boolean;
  /**
   * The turn was stopped on purpose (Interrupt button / `/stop`), not by an
   * error or a timeout. The caller says so instead of apologising.
   */
  interrupted?: boolean;
}

/** One line per tool call, latest step shown: "Bash: pnpm test". */
export function formatToolStep(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const short = (v: unknown, max = 80): string => {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  };
  if (name.startsWith('mcp__flow__')) return `Flow: ${name.slice('mcp__flow__'.length)}`;
  if (name.startsWith('mcp__')) return name.replace(/^mcp__/, '').replace('__', ': ');
  switch (name) {
    case 'Bash':
      return `Bash: ${short(i.command)}`;
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return `${name}: ${short(path.basename(String(i.file_path ?? i.notebook_path ?? '')))}`;
    case 'Glob':
    case 'Grep':
      return `${name}: ${short(i.pattern)}`;
    case 'WebSearch':
      return `WebSearch: ${short(i.query)}`;
    case 'WebFetch':
      return `WebFetch: ${short(i.url)}`;
    case 'Task':
    case 'Agent':
      return `Agent: ${short(i.description ?? i.prompt)}`;
    case 'TodoWrite':
      return 'updating plan';
    default:
      return name;
  }
}

interface StreamEvent {
  type?: string;
  subtype?: string;
  result?: string;
  is_error?: boolean;
  message?: { content?: Array<{ type?: string; name?: string; input?: unknown; text?: string }> };
}

/**
 * Feed stream-json stdout lines; emits tool steps and captures the final
 * result. Tolerant of non-JSON noise on stdout.
 */
export class StreamJsonParser {
  private buf = '';
  finalText = '';
  isError = false;
  sawResult = false;
  /**
   * The failing result's `subtype` (`error_max_turns`, `error_during_execution`,
   * …). Kept because the boolean alone can't tell an operator whether to raise a
   * cap or go read a stack trace.
   */
  errorSubtype = '';
  /** Any well-formed event — see RunResult.sawSession. */
  sawEvent = false;
  /**
   * The most recent assistant text block. A run killed mid-turn never gets its
   * terminal result event, so `finalText` stays empty and this is all there is
   * to show for it.
   */
  lastText = '';

  /**
   * `onText` receives every assistant text block as it arrives — the agent's
   * running commentary, which used to be parsed and dropped on the floor
   * (#162). A block identical to the one before it is swallowed: relaying the
   * same sentence twice reads as a glitch, never as progress.
   */
  constructor(
    private readonly onToolStep: (step: string) => void,
    private readonly onText: (text: string) => void = () => {},
  ) {}

  feed(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let ev: StreamEvent;
    try {
      ev = JSON.parse(line) as StreamEvent;
    } catch {
      return; // non-JSON noise
    }
    if (typeof ev.type === 'string') this.sawEvent = true;
    if (ev.type === 'assistant') {
      for (const block of ev.message?.content ?? []) {
        if (block.type === 'tool_use' && block.name) this.onToolStep(formatToolStep(block.name, block.input));
        else if (block.type === 'text' && block.text?.trim()) {
          const text = block.text.trim();
          if (text !== this.lastText) this.onText(text);
          // Latest wins: on a dead run the newest one is "where it got to".
          this.lastText = text;
        }
      }
    } else if (ev.type === 'result') {
      this.sawResult = true;
      this.isError = ev.is_error === true || (ev.subtype !== undefined && ev.subtype !== 'success');
      this.errorSubtype = this.isError ? (ev.subtype ?? '') : '';
      this.finalText = ev.result ?? '';
    }
  }
}

export function buildClaudeArgs(cfg: RuntimeConfig, opts: RunOpts): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  args.push(opts.resume ? '--resume' : '--session-id', opts.sessionId);
  args.push('--append-system-prompt', opts.systemPrompt);
  args.push('--max-turns', String(cfg.maxTurns));
  if (cfg.model) args.push('--model', cfg.model);
  if (cfg.permissionMode) args.push('--permission-mode', cfg.permissionMode);
  // Default is full permissions (operator ruling): with neither permissionMode
  // nor allowedTools configured, the agent runs unrestricted in its cwd.
  // Setting either one opts into scoped permissions instead.
  else if (cfg.allowedTools.length === 0) args.push('--permission-mode', 'bypassPermissions');
  const allowed = [...cfg.allowedTools];
  if (opts.mcpConfigPath) {
    // = form: --mcp-config and --allowedTools are variadic in the claude CLI
    // and would otherwise swallow the trailing positional prompt
    args.push(`--mcp-config=${opts.mcpConfigPath}`);
    allowed.push('mcp__flow'); // pre-grant the flow tools — headless runs can't prompt
  }
  if (allowed.length) args.push(`--allowedTools=${allowed.join(',')}`);
  args.push(...cfg.extraArgs);
  args.push(opts.prompt);
  return args;
}

function buildCodexArgs(cfg: RuntimeConfig, opts: RunOpts): string[] {
  // STUB: baseline contract only (stdout = reply). No session resume.
  return ['exec', '--skip-git-repo-check', ...cfg.extraArgs, opts.prompt];
}

/** Demo mode: static canned reply, no CLI spawn. */
export const DEMO_REPLY = 'Your message was received';

/** Process-group ids of in-flight runtime spawns, for shutdown cleanup. */
const liveGroups = new Set<number>();

/**
 * Take down a runtime and everything it started. The negative pid targets the
 * whole process group: a bare `child.kill()` reaches only the CLI, leaving its
 * Bash-tool grandchildren (builds, test runs, dev servers) orphaned and running
 * unsupervised. SIGTERM first so the CLI can flush its session transcript —
 * that transcript is what makes the next turn resumable.
 */
function killGroup(pid: number, graceMs: number): void {
  const send = (sig: NodeJS.Signals): void => {
    try {
      process.kill(-pid, sig);
    } catch {
      // already exited, or never got its own group — nothing to do
    }
  };
  send('SIGTERM');
  if (graceMs <= 0) {
    send('SIGKILL');
    return;
  }
  const t = setTimeout(() => send('SIGKILL'), graceMs);
  t.unref();
}

/**
 * Shutdown hook: runtimes are spawned detached (own process group), so they no
 * longer die with the bridge on Ctrl-C — the daemon has to end them itself.
 */
export function killAllRuntimes(): void {
  for (const pid of liveGroups) killGroup(pid, 0);
  liveGroups.clear();
}

/**
 * Turn a failing `result` event into something an operator can act on. The turn
 * cap is by far the most common failure and its fix is a config change, so it
 * says so by name — and carries the cap, because "raise it" needs a number.
 */
export function describeResultError(subtype: string, maxTurns: number): string {
  if (subtype === 'error_max_turns') return `agent exceeded max turns (${maxTurns})`;
  if (subtype) return `runtime reported ${subtype}`;
  return 'runtime reported an error';
}

/** What an interrupted turn resolves to — no CLI error, just a stopped run. */
const INTERRUPTED = 'interrupted';

export async function runRuntime(cfg: RuntimeConfig, opts: RunOpts): Promise<RunResult> {
  if (opts.signal?.aborted) return { ok: false, text: '', error: INTERRUPTED, interrupted: true };
  if (cfg.kind === 'demo') {
    // Brief pause so the typing indicator is visible in clients — and long
    // enough to be interruptible, which is what makes demo mode testable.
    const stopped = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 500);
      opts.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        resolve(true);
      });
    });
    if (stopped) return { ok: false, text: '', error: INTERRUPTED, interrupted: true };
    return { ok: true, text: DEMO_REPLY };
  }
  const args = cfg.kind === 'claude' ? buildClaudeArgs(cfg, opts) : buildCodexArgs(cfg, opts);
  return new Promise((resolve) => {
    const child = spawn(cfg.command, args, {
      cwd: cfg.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      // Own process group, so expiry can kill the agent's whole subprocess tree
      // rather than just the CLI. Costs us the automatic teardown on bridge
      // exit — killAllRuntimes() covers that.
      detached: true,
    });
    if (child.pid) liveGroups.add(child.pid);
    const parser = new StreamJsonParser(opts.onToolStep, (t) => opts.onText?.(t));
    let stdout = '';
    let stderr = '';
    let settled = false;
    let idleTimer: NodeJS.Timeout | null = null;
    let capTimer: NodeJS.Timeout | null = null;

    const cleanup = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      if (capTimer) clearTimeout(capTimer);
      if (child.pid) liveGroups.delete(child.pid);
      opts.signal?.removeEventListener('abort', onAbort);
    };
    /**
     * End the run early. An expiry and an interrupt take the same path — kill
     * the process group, salvage whatever the agent said — and differ only in
     * how the caller reports it.
     */
    const expire = (error: string, interrupted = false): void => {
      if (settled) return;
      settled = true;
      cleanup();
      opts.log(interrupted ? 'run interrupted — killing the process group' : `runtime expired: ${error} — killing the process group`);
      if (child.pid) killGroup(child.pid, 5000);
      // The terminal result event will never arrive, so salvage the last thing
      // the agent said (codex has no events — its raw stdout is the contract).
      resolve({
        ok: false,
        text: cfg.kind === 'claude' ? parser.lastText : stdout.trim(),
        error,
        sawSession: parser.sawEvent,
        interrupted,
      });
    };
    function onAbort(): void {
      expire(INTERRUPTED, true);
    }
    opts.signal?.addEventListener('abort', onAbort);
    /**
     * Rearmed by every byte the runtime emits. A turn that is still working
     * narrates itself (stream-json emits an event per tool call), so it never
     * expires no matter how long it runs; only genuine silence does.
     */
    const bumpIdle = (): void => {
      if (settled) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => expire(`no output for ${cfg.idleTimeoutSec}s`), cfg.idleTimeoutSec * 1000);
    };
    capTimer = setTimeout(() => expire(`hit the ${cfg.timeoutSec}s run cap`), cfg.timeoutSec * 1000);
    bumpIdle();

    child.stdout.on('data', (d: Buffer) => {
      bumpIdle();
      const s = d.toString('utf8');
      stdout += s;
      if (cfg.kind === 'claude') parser.feed(s);
    });
    child.stderr.on('data', (d: Buffer) => {
      bumpIdle();
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false, text: '', error: `could not spawn ${cfg.command}: ${err.message}` });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      parser.feed('\n'); // flush a trailing unterminated line
      if (cfg.kind === 'claude') {
        if (parser.sawResult && !parser.isError) return resolve({ ok: true, text: parser.finalText, sawSession: true });
        // Error text stays short: the runtime's own words ride along as
        // salvage instead of being spliced in truncated at 300 chars. The
        // subtype is the exception — it's the one word that says what to do.
        const error = parser.sawResult
          ? describeResultError(parser.errorSubtype, cfg.maxTurns)
          : `runtime exited ${code} without a result${stderr ? `: ${stderr.slice(-300)}` : ''}`;
        return resolve({
          ok: false,
          text: parser.finalText || parser.lastText,
          error,
          sawSession: parser.sawEvent,
        });
      }
      // baseline contract: stdout is the reply
      if (code === 0) return resolve({ ok: true, text: stdout.trim() });
      return resolve({ ok: false, text: '', error: `runtime exited ${code}${stderr ? `: ${stderr.slice(-300)}` : ''}` });
    });
  });
}
