// Interactive first-run setup (AGENT_MEMBERS.md): register the agent like a
// person — name, username + key, and a human sponsor by email — then show the
// pairing code and wait for the sponsor to approve inside Flow. Saves
// agent.json and hands back the path so the caller starts the daemon
// immediately. Advanced knobs (permissionMode, allowedTools, eventScope, …)
// are edited in the saved file.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { FlowApi, newAgentKey, startAgentRegistration, waitForApproval } from './api.js';
import { expandHome } from './config.js';

async function ask(rl: readline.Interface, q: string, def?: string): Promise<string> {
  const suffix = def ? ` [${def}]` : '';
  const answer = (await rl.question(`${q}${suffix}: `)).trim();
  return answer || def || '';
}

/** Best-effort username from the display name: "Repo Bot!" → "repo-bot". */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 32);
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

    const existing = await ask(rl, 'Existing agent token (flow-agent-token-…) to reuse — or press enter to register');
    let agentToken: string;
    let agentUsername: string | undefined;
    let agentKey: string | undefined;
    if (existing.startsWith('flow-agent-token-')) {
      // Existing agent: validate the token and skip registration.
      console.log('\nAgent token detected — verifying…');
      const me = await new FlowApi(serverUrl, existing).me();
      console.log(`connecting as existing agent ${me.displayName} <@${me.id}>\n`);
      agentToken = existing;
    } else {
      let name = '';
      while (!name) name = await ask(rl, 'Agent name (shown in Flow, e.g. RepoBot)');
      let username = '';
      while (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
        username = (await ask(rl, 'Username (the agent’s handle — its durable login)', slugify(name))).toLowerCase();
      }
      let sponsorEmail = '';
      while (!sponsorEmail.includes('@')) {
        sponsorEmail = await ask(rl, 'Sponsor email (YOUR Flow login — you approve and are responsible for this agent)');
      }
      const description = await ask(rl, 'Description (optional)');
      const key = newAgentKey();

      console.log('\nRegistering…');
      const start = await startAgentRegistration(serverUrl, {
        username,
        key,
        name,
        sponsorEmail,
        ...(description ? { description } : {}),
      });
      console.log('');
      console.log(`  pairing code:  ${start.code}`);
      console.log('');
      console.log(`Now approve this request inside Flow (as ${sponsorEmail}) — a prompt is waiting there.`);
      console.log('Only approve if it shows the SAME code. Waiting (expires in 10 minutes)…');
      const res = await waitForApproval(serverUrl, start);
      if (res.status !== 'approved' || !res.agentToken) {
        throw new Error(
          res.status === 'denied' ? 'the sponsor denied the request' : 'the request expired — run setup again',
        );
      }
      console.log(`\napproved! registered ${res.user!.displayName} <@${res.user!.id}> in workspace "${res.workspace!.name}"\n`);
      agentToken = res.agentToken;
      agentUsername = username;
      agentKey = key;
    }

    let kind = '';
    while (!['claude', 'codex', 'demo'].includes(kind)) {
      kind = (await ask(rl, 'Runtime — claude, codex, or demo', 'claude')).toLowerCase();
    }
    const config: Record<string, unknown> = {
      serverUrl,
      agentToken,
      // username + key are the agent's durable credentials: `flow-agent-bridge
      // login` re-mints a token from them if agent.json's token is ever lost.
      ...(agentUsername ? { agentUsername } : {}),
      ...(agentKey ? { agentKey } : {}),
      runtime: { kind } as Record<string, unknown>,
    };
    if (kind !== 'demo') {
      let cwd = '';
      while (!cwd) {
        const answer = await ask(rl, 'Working directory the agent runs in (its identity — e.g. a repo checkout)', '.');
        const resolved = path.resolve(expandHome(answer));
        if (fs.existsSync(resolved)) cwd = resolved;
        else console.log(`  ${resolved} does not exist — try again`);
      }
      (config.runtime as Record<string, unknown>).cwd = cwd;
      // No allowedTools written: the default is full permissions in the cwd
      // (operator ruling) — add allowedTools/permissionMode to the saved
      // config to scope the agent down.
    }

    const abs = path.resolve(configPath);
    fs.writeFileSync(abs, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    console.log(`\nSaved ${abs} (contains the agent token and key — keep it private).`);
    console.log('Edit it any time for permissions, event scope, progress mode, etc. (see AGENT_MEMBERS.md).\n');
    return abs;
  } finally {
    rl.close();
  }
}
