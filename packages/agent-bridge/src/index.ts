#!/usr/bin/env node
// flow-agent-bridge CLI:
//   flow-agent-bridge run <config.json>     start the daemon
//   flow-agent-bridge register --server <url> --invite <key> [--name <name>]
//                              [--description <text>] [--avatar <url>]
//   (--name optional: falls back to the invite's nameHint server-side)
//   flow-agent-bridge mcp                   (internal) the flow MCP stdio server
import { loadConfig } from './config.js';
import { AgentBridge } from './bridge.js';
import { registerAgent } from './api.js';
import { runMcpServer } from './mcp-server.js';

function usage(): never {
  console.error(
    'usage:\n' +
      '  flow-agent-bridge run <config.json>\n' +
      '  flow-agent-bridge register --server <url> --invite <key> [--name <name>] [--description <text>] [--avatar <url>]\n',
  );
  process.exit(2);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'mcp') return runMcpServer();
  if (cmd === 'register') {
    const server = flag(rest, 'server');
    const invite = flag(rest, 'invite');
    const name = flag(rest, 'name');
    if (!server || !invite) usage();
    const res = await registerAgent(server, {
      inviteKey: invite,
      ...(name ? { name } : {}),
      ...(flag(rest, 'description') ? { description: flag(rest, 'description')! } : {}),
      ...(flag(rest, 'avatar') ? { avatarUrl: flag(rest, 'avatar')! } : {}),
    });
    console.log(`registered ${res.user.displayName} <@${res.user.id}> in workspace "${res.workspace.name}"`);
    console.log('');
    console.log('agent token (shown ONCE — put it in your bridge config as "agentToken"):');
    console.log(`  ${res.agentToken}`);
    return;
  }
  // `run <config>` (or a bare config path for convenience)
  const configPath = cmd === 'run' ? rest[0] : cmd;
  if (!configPath) usage();
  const cfg = loadConfig(configPath);
  const bridge = new AgentBridge(cfg);
  await bridge.start();
  const shutdown = (): void => {
    bridge.stop();
    setTimeout(() => process.exit(0), 200);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: Error) => {
  console.error(`fatal: ${err.message}`);
  process.exit(1);
});
