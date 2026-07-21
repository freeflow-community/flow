// Bridge configuration (AGENTS_DESIGN.md): JSON file, one agent per config.
// (The spec allows "agent.toml or JSON"; the bridge ships JSON — no TOML
// parser in Node's stdlib, and one less dependency.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** "~" / "~/x" → the user's home (shells don't expand ~ inside JSON configs or wizard answers). */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

export type ProgressMode = 'thinking' | 'typing' | 'silent';
export type EventScope = 'mentions' | 'all';
export type RuntimeKind = 'claude' | 'codex' | 'demo';

export interface RuntimeConfig {
  /**
   * 'claude' (rich: sessions, stream-json thinking steps, MCP),
   * 'codex' (stub: baseline stdout contract), or
   * 'demo' (no CLI at all — always replies "Your message was received";
   * exercises the full event→reply pipeline for local testing).
   */
  kind: RuntimeKind;
  /** Executable override (default: the kind's CLI name). A fake runtime script works here for tests. */
  command: string;
  /** Extra args appended verbatim before the prompt. */
  extraArgs: string[];
  /** Working directory the CLI runs in — the agent's identity (a repo checkout). */
  cwd: string;
  /** --permission-mode passthrough (claude). Headless runs use pre-granted permissions — scope them. */
  permissionMode?: string | undefined;
  /** --allowedTools passthrough (claude), e.g. ["Read", "Bash(pnpm test)"]. */
  allowedTools: string[];
  /** --max-turns cap (claude). */
  maxTurns: number;
  /** Wall-clock timeout per run, seconds. */
  timeoutSec: number;
  /** MCP rich mode: expose the flow MCP server to the runtime (claude only). */
  mcp: boolean;
  /** Extra text appended to the Flow system prompt. */
  systemPromptExtra?: string | undefined;
}

export interface BridgeConfig {
  serverUrl: string;
  agentToken: string;
  /**
   * Log file (every line the daemon prints, same timestamped format).
   * Default: <config name>.log next to the config (agent.json → agent.log).
   * Explicit JSON null disables file logging; `~` expands.
   */
  logFile: string | null;
  runtime: RuntimeConfig;
  /** Default 'mentions': @-mentions + DMs only. 'all' adds full traffic of channels the agent is in. */
  eventScope: EventScope;
  /** Never respond to other agents (loop safety). Default false. */
  respondToAgents: boolean;
  /** Max conversations processed concurrently (serial within one conversation). */
  concurrency: number;
  progress: ProgressMode;
}

interface RawConfig {
  serverUrl?: string;
  agentToken?: string;
  logFile?: string | null;
  runtime?: Partial<RuntimeConfig> & { kind?: string };
  eventScope?: string;
  respondToAgents?: boolean;
  concurrency?: number;
  progress?: string;
}

export function loadConfig(configPath: string): BridgeConfig {
  const abs = path.resolve(configPath);
  let raw: RawConfig;
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8')) as RawConfig;
  } catch (err) {
    throw new Error(`could not read config ${abs}: ${(err as Error).message}`);
  }
  const serverUrl = (raw.serverUrl ?? process.env.FLOW_SERVER_URL ?? '').replace(/\/+$/, '');
  if (!serverUrl) throw new Error('config: serverUrl is required (or FLOW_SERVER_URL)');
  const agentToken = raw.agentToken ?? process.env.FLOW_AGENT_TOKEN ?? '';
  if (!agentToken) throw new Error('config: agentToken is required (or FLOW_AGENT_TOKEN)');

  const kind = (raw.runtime?.kind ?? 'claude') as RuntimeKind;
  if (kind !== 'claude' && kind !== 'codex' && kind !== 'demo')
    throw new Error(`config: unknown runtime.kind "${kind}"`);
  const r = raw.runtime ?? {};
  const runtime: RuntimeConfig = {
    kind,
    command: r.command ?? (kind === 'codex' ? 'codex' : 'claude'),
    extraArgs: r.extraArgs ?? [],
    cwd: path.resolve(path.dirname(abs), expandHome(r.cwd ?? '.')),
    permissionMode: r.permissionMode,
    allowedTools: r.allowedTools ?? [],
    maxTurns: r.maxTurns ?? 100, // real coding tasks blow past small caps — 25 wedged first turns via max-turns errors
    timeoutSec: r.timeoutSec ?? 300,
    mcp: r.mcp ?? (kind === 'claude'),
    systemPromptExtra: r.systemPromptExtra,
  };

  // A missing cwd would otherwise surface as a misleading "spawn <cli> ENOENT"
  // (node reports ENOENT for a bad working directory too). Demo never spawns.
  if (kind !== 'demo' && !fs.existsSync(runtime.cwd)) {
    throw new Error(`config: runtime.cwd does not exist: ${runtime.cwd}`);
  }

  const eventScope = (raw.eventScope ?? 'mentions') as EventScope;
  if (eventScope !== 'mentions' && eventScope !== 'all') throw new Error(`config: bad eventScope "${eventScope}"`);
  const progress = (raw.progress ?? 'thinking') as ProgressMode;
  if (!['thinking', 'typing', 'silent'].includes(progress)) throw new Error(`config: bad progress "${progress}"`);

  const logFile =
    raw.logFile === null
      ? null
      : raw.logFile !== undefined
        ? path.resolve(path.dirname(abs), expandHome(raw.logFile))
        : abs.replace(/\.json$/i, '') + '.log';

  return {
    serverUrl,
    agentToken,
    logFile,
    runtime,
    eventScope,
    respondToAgents: raw.respondToAgents ?? false,
    concurrency: Math.max(1, raw.concurrency ?? 4),
    progress,
  };
}
