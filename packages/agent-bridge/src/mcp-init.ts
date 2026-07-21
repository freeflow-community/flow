// `flow-agent-bridge mcp-init [config.json]` — write a `.mcp.json` in the
// CURRENT directory so MCP clients (the Claude CLI reads ./.mcp.json on
// startup) load the bundled `flow` MCP server directly, acting as this
// agent. No daemon, no presence, no push — the client pulls via read_messages.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlowApi } from './api.js';
import { loadConfig } from './config.js';

const MCP_JSON = '.mcp.json';

/**
 * The entry's command: the global bin when it's on PATH (portable, survives
 * upgrades), else this install pinned by absolute path (repo checkouts where
 * the bin isn't linked).
 */
function serverCommand(log: (m: string) => void): { command: string; args: string[] } {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', ['flow-agent-bridge'], { stdio: 'ignore' });
    return { command: 'flow-agent-bridge', args: ['mcp'] };
  } catch {
    const entry = fileURLToPath(new URL('./index.js', import.meta.url));
    log(`flow-agent-bridge not on PATH — pinning the server command to this install (${entry})`);
    return { command: process.execPath, args: [entry, 'mcp'] };
  }
}

export function buildFlowServerEntry(opts: {
  serverUrl: string;
  agentToken: string;
  workspaceId: string;
  command: string;
  args: string[];
}): Record<string, unknown> {
  return {
    command: opts.command,
    args: opts.args,
    env: {
      FLOW_SERVER_URL: opts.serverUrl,
      FLOW_AGENT_TOKEN: opts.agentToken,
      FLOW_WORKSPACE_ID: opts.workspaceId,
      // No FLOW_CHANNEL_ID on purpose: channel-agnostic — the client picks
      // targets per call via list_channels.
    },
  };
}

/** Merge the flow entry into existing .mcp.json content (or a fresh doc). */
export function mergeMcpJson(
  existing: string | undefined,
  flowEntry: Record<string, unknown>,
): { json: string; replaced: boolean } {
  let doc: Record<string, unknown> = {};
  if (existing !== undefined) {
    try {
      doc = JSON.parse(existing) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`${MCP_JSON} exists but isn't valid JSON — fix or remove it first (${(err as Error).message})`);
    }
  }
  const servers = (doc.mcpServers ?? {}) as Record<string, unknown>;
  const replaced = 'flow' in servers;
  servers.flow = flowEntry;
  doc.mcpServers = servers;
  return { json: JSON.stringify(doc, null, 2) + '\n', replaced };
}

/** Keep the token out of git: append .mcp.json to an existing .gitignore; warn otherwise. */
function guardGitignore(cwd: string, log: (m: string) => void): void {
  const p = path.join(cwd, '.gitignore');
  if (!fs.existsSync(p)) {
    log(`warning: ${MCP_JSON} contains the agent token — don't commit it`);
    return;
  }
  const content = fs.readFileSync(p, 'utf8');
  if (content.split('\n').some((l) => l.trim() === MCP_JSON)) return;
  fs.appendFileSync(p, `${content.endsWith('\n') || content.length === 0 ? '' : '\n'}${MCP_JSON}\n`);
  log(`added ${MCP_JSON} to .gitignore`);
}

export async function runMcpInit(configPath: string): Promise<void> {
  const log = (m: string): void => console.log(`[mcp-init] ${m}`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`no config at ${configPath} — run \`flow-agent-bridge ${path.basename(configPath)}\` first (interactive setup)`);
  }
  const cfg = loadConfig(configPath);
  const api = new FlowApi(cfg.serverUrl, cfg.agentToken);
  // Validate the token and resolve the workspace id (agent.json doesn't store
  // it) — upload_file/list_channels/list_users need FLOW_WORKSPACE_ID.
  const [me, workspaces] = await Promise.all([api.me(), api.myWorkspaces()]);
  if (workspaces.length === 0) throw new Error('this agent belongs to no workspace');
  const workspace = workspaces[0]!;
  if (workspaces.length > 1) {
    log(`agent is in ${workspaces.length} workspaces — using "${workspace.name}" (the first, as the daemon does)`);
  }

  const entry = buildFlowServerEntry({
    serverUrl: cfg.serverUrl,
    agentToken: cfg.agentToken,
    workspaceId: workspace.id,
    ...serverCommand(log),
  });

  const target = path.join(process.cwd(), MCP_JSON);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined;
  const { json, replaced } = mergeMcpJson(existing, entry);
  fs.writeFileSync(target, json, { mode: 0o600 });
  guardGitignore(process.cwd(), log);

  log(
    `${replaced ? 'updated the flow entry in' : 'wrote'} ${target} — the flow MCP server will act as ` +
      `${me.displayName} <@${me.id}> in "${workspace.name}"`,
  );
  log('run your MCP client here (e.g. `claude`) and approve the "flow" server when prompted');
}
