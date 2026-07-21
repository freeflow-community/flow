#!/usr/bin/env node
// flow-agent-bridge CLI:
//   flow-agent-bridge [config.json]         the one command: if the config
//                                           exists, run the daemon; if not,
//                                           interactive setup (register →
//                                           sponsor approval → save) then run.
//                                           Default config path: ./agent.json
//   flow-agent-bridge run <config.json>     start the daemon (no setup)
//   flow-agent-bridge register --server <url> --sponsor <email> --username <handle>
//                              --name <name> [--key <secret>] [--description <text>] [--avatar <url>]
//   (prints a pairing code and blocks until the sponsor approves inside Flow;
//    --key omitted → a fresh key is generated and printed)
//   flow-agent-bridge login --server <url> --username <handle> --key <secret>
//   (mints a fresh agent token, revoking the old one — the lost-agent.json path)
//   flow-agent-bridge mcp                   (internal) the flow MCP stdio server
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { AgentBridge } from './bridge.js';
import { agentLogin, newAgentKey, startAgentRegistration, waitForApproval } from './api.js';
import { runMcpServer } from './mcp-server.js';
import { runSetup } from './setup.js';

function usage(): never {
  console.error(
    'usage:\n' +
      '  flow-agent-bridge [config.json]      setup (if missing) + run — default ./agent.json\n' +
      '  flow-agent-bridge run <config.json>\n' +
      '  flow-agent-bridge register --server <url> --sponsor <email> --username <handle> --name <name>\n' +
      '                             [--key <secret>] [--description <text>] [--avatar <url>]\n' +
      '  flow-agent-bridge login --server <url> --username <handle> --key <secret>\n',
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
    const sponsor = flag(rest, 'sponsor');
    const username = flag(rest, 'username');
    const name = flag(rest, 'name');
    if (!server || !sponsor || !username || !name) usage();
    const key = flag(rest, 'key') ?? newAgentKey();
    const generatedKey = !flag(rest, 'key');
    const start = await startAgentRegistration(server, {
      username,
      key,
      name,
      sponsorEmail: sponsor,
      ...(flag(rest, 'description') ? { description: flag(rest, 'description')! } : {}),
      ...(flag(rest, 'avatar') ? { avatarUrl: flag(rest, 'avatar')! } : {}),
    });
    console.log(`pairing code:  ${start.code}`);
    console.log(`waiting for ${sponsor} to approve inside Flow (they must see the SAME code)…`);
    const res = await waitForApproval(server, start);
    if (res.status !== 'approved' || !res.agentToken) {
      throw new Error(
        res.status === 'denied' ? 'the sponsor denied the request' : 'the request expired — re-run register',
      );
    }
    console.log(`registered ${res.user!.displayName} <@${res.user!.id}> in workspace "${res.workspace!.name}"`);
    console.log('');
    console.log('agent token (put it in your bridge config as "agentToken"):');
    console.log(`  ${res.agentToken}`);
    if (generatedKey) {
      console.log('');
      console.log('agent key (shown ONCE — with the username, this recovers a lost token via `login`):');
      console.log(`  username: ${username}`);
      console.log(`  key:      ${key}`);
    }
    return;
  }
  if (cmd === 'login') {
    const server = flag(rest, 'server');
    const username = flag(rest, 'username');
    const key = flag(rest, 'key');
    if (!server || !username || !key) usage();
    const res = await agentLogin(server, username, key);
    console.log(`logged in as ${res.user.displayName} <@${res.user.id}>`);
    console.log('fresh agent token (the previous token is now revoked):');
    console.log(`  ${res.agentToken}`);
    return;
  }
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') usage();
  // `run <config>` requires the config; a bare path (or no args → ./agent.json)
  // runs interactive setup first when the file doesn't exist.
  let configPath = cmd === 'run' ? rest[0] : cmd ?? 'agent.json';
  if (!configPath) usage();
  if (cmd !== 'run' && !fs.existsSync(configPath)) configPath = await runSetup(configPath);
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
