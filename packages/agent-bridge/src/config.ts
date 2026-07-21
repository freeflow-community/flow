// Bridge configuration (AGENTS_DESIGN.md): JSON file, one agent per config.
// (The spec allows "agent.toml or JSON"; the bridge ships JSON — no TOML
// parser in Node's stdlib, and one less dependency.)
import fs from 'node:fs';
import path from 'node:path';

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
    cwd: path.resolve(path.dirname(abs), r.cwd ?? '.'),
    permissionMode: r.permissionMode,
    allowedTools: r.allowedTools ?? [],
    maxTurns: r.maxTurns ?? 25,
    timeoutSec: r.timeoutSec ?? 300,
    mcp: r.mcp ?? (kind === 'claude'),
    systemPromptExtra: r.systemPromptExtra,
  };

  const eventScope = (raw.eventScope ?? 'mentions') as EventScope;
  if (eventScope !== 'mentions' && eventScope !== 'all') throw new Error(`config: bad eventScope "${eventScope}"`);
  const progress = (raw.progress ?? 'thinking') as ProgressMode;
  if (!['thinking', 'typing', 'silent'].includes(progress)) throw new Error(`config: bad progress "${progress}"`);

  return {
    serverUrl,
    agentToken,
    runtime,
    eventScope,
    respondToAgents: raw.respondToAgents ?? false,
    concurrency: Math.max(1, raw.concurrency ?? 4),
    progress,
  };
}
