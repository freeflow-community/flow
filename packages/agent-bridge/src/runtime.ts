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
  onToolStep(step: string): void;
  log(msg: string): void;
}

export interface RunResult {
  ok: boolean;
  text: string;
  error?: string;
  /**
   * The runtime emitted a result event (even an error one, e.g. max-turns) —
   * the CLI session definitely exists and can be resumed with its context.
   */
  sawResult?: boolean;
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

  constructor(private readonly onToolStep: (step: string) => void) {}

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
    if (ev.type === 'assistant') {
      for (const block of ev.message?.content ?? []) {
        if (block.type === 'tool_use' && block.name) this.onToolStep(formatToolStep(block.name, block.input));
      }
    } else if (ev.type === 'result') {
      this.sawResult = true;
      this.isError = ev.is_error === true || (ev.subtype !== undefined && ev.subtype !== 'success');
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

export async function runRuntime(cfg: RuntimeConfig, opts: RunOpts): Promise<RunResult> {
  if (cfg.kind === 'demo') {
    // Brief pause so the typing indicator is visible in clients.
    await new Promise((r) => setTimeout(r, 500));
    return { ok: true, text: DEMO_REPLY };
  }
  const args = cfg.kind === 'claude' ? buildClaudeArgs(cfg, opts) : buildCodexArgs(cfg, opts);
  return new Promise((resolve) => {
    const child = spawn(cfg.command, args, {
      cwd: cfg.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    const parser = new StreamJsonParser(opts.onToolStep);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ ok: false, text: '', error: `timed out after ${cfg.timeoutSec}s` });
    }, cfg.timeoutSec * 1000);
    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString('utf8');
      stdout += s;
      if (cfg.kind === 'claude') parser.feed(s);
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, text: '', error: `could not spawn ${cfg.command}: ${err.message}` });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parser.feed('\n'); // flush a trailing unterminated line
      if (cfg.kind === 'claude') {
        if (parser.sawResult && !parser.isError) return resolve({ ok: true, text: parser.finalText, sawResult: true });
        const error = parser.sawResult
          ? `runtime reported an error${parser.finalText ? `: ${parser.finalText.slice(0, 300)}` : ''}`
          : `runtime exited ${code} without a result${stderr ? `: ${stderr.slice(-300)}` : ''}`;
        return resolve({ ok: false, text: parser.finalText, error, sawResult: parser.sawResult });
      }
      // baseline contract: stdout is the reply
      if (code === 0) return resolve({ ok: true, text: stdout.trim() });
      return resolve({ ok: false, text: '', error: `runtime exited ${code}${stderr ? `: ${stderr.slice(-300)}` : ''}` });
    });
  });
}
