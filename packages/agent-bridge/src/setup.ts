// Interactive first-run setup: prompt for the invite key, exchange it for an
// agent token, ask the handful of questions that matter, save agent.json, and
// hand back the path so the caller can start the daemon immediately.
// Advanced knobs (permissionMode, allowedTools, eventScope, …) are edited in
// the saved file — see AGENTS.md.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { registerAgent } from './api.js';

async function ask(rl: readline.Interface, q: string, def?: string): Promise<string> {
  const suffix = def ? ` [${def}]` : '';
  const answer = (await rl.question(`${q}${suffix}: `)).trim();
  return answer || def || '';
}

export async function runSetup(configPath: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(`no config at ${configPath} and stdin is not a TTY — run interactively or pass a config path`);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('No config found — setting up a new agent.\n');
    const serverUrl = (
      await ask(rl, 'Flow server URL', process.env.FLOW_SERVER_URL ?? 'https://app.flowtoo.org')
    ).replace(/\/+$/, '');
    let inviteKey = '';
    while (!inviteKey.startsWith('flow-agent-')) {
      inviteKey = await ask(rl, 'Invite key (flow-agent-…, from "Invite an Agent" in the web app)');
      if (!inviteKey.startsWith('flow-agent-')) console.log('  that does not look like a flow-agent-… key');
    }
    const name = await ask(rl, 'Agent name (blank = use the invite’s name hint)');
    const description = await ask(rl, 'Description (optional)');

    console.log('\nRegistering…');
    const res = await registerAgent(serverUrl, {
      inviteKey,
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
    });
    console.log(`registered ${res.user.displayName} <@${res.user.id}> in workspace "${res.workspace.name}"\n`);

    let kind = '';
    while (!['claude', 'codex', 'demo'].includes(kind)) {
      kind = (await ask(rl, 'Runtime — claude, codex, or demo', 'claude')).toLowerCase();
    }
    const config: Record<string, unknown> = {
      serverUrl,
      agentToken: res.agentToken,
      runtime: { kind } as Record<string, unknown>,
    };
    if (kind !== 'demo') {
      const cwd = await ask(rl, 'Working directory the agent runs in (its identity — e.g. a repo checkout)', '.');
      (config.runtime as Record<string, unknown>).cwd = cwd;
      if (kind === 'claude') {
        // Sane read-only default so a fresh agent can answer questions without
        // being able to mutate anything; widen in the config file deliberately.
        (config.runtime as Record<string, unknown>).allowedTools = ['Read', 'Grep', 'Glob'];
      }
    }

    const abs = path.resolve(configPath);
    fs.writeFileSync(abs, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    console.log(`\nSaved ${abs} (contains the agent token — keep it private).`);
    console.log('Edit it any time for permissions, event scope, progress mode, etc. (see AGENTS.md).\n');
    return abs;
  } finally {
    rl.close();
  }
}
