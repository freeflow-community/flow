// Interactive first-run setup (AGENT_MEMBERS.md): register the agent like a
// person and hand back a ready-to-run agent.json. The streamlined flow (phase
// 15) asks only the four things a person must decide — agent name, handle,
// sponsor email, harness — UP FRONT, then registers and waits for the sponsor
// to approve the pairing code inside Flow. Everything else (server URL, an
// existing token to reuse, a description, the working directory) has a sensible
// default and is overridable with a CLI flag, so the happy path is four
// answers. Advanced knobs (permissionMode, allowedTools, eventScope, …) are
// edited in the saved file.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { FlowApi, newAgentKey, startAgentRegistration, waitForApproval } from './api.js';
import { expandHome } from './config.js';

/** Optional values that skip their prompt when supplied as CLI flags. */
export interface SetupOptions {
  serverUrl?: string | undefined; // --server / --host
  token?: string | undefined; // --token: reuse an existing agent, skip registration
  name?: string | undefined; // --name
  username?: string | undefined; // --username / --handle
  sponsor?: string | undefined; // --sponsor
  harness?: string | undefined; // --harness / --runtime
  description?: string | undefined; // --description
  cwd?: string | undefined; // --cwd
}

const HARNESSES = ['claude', 'codex', 'demo'];

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

export async function runSetup(configPath: string, opts: SetupOptions = {}): Promise<string> {
  const serverUrl = (opts.serverUrl ?? process.env.FLOW_SERVER_URL ?? 'https://app.flowtoo.org').replace(/\/+$/, '');
  const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;

  // A required value: take the flag if given (validated), otherwise prompt.
  // Without a TTY and without the flag there is no way to obtain it.
  async function required(
    provided: string | undefined,
    label: string,
    opt: { def?: string; normalize?: (s: string) => string; validate?: (s: string) => boolean } = {},
  ): Promise<string> {
    const norm = opt.normalize ?? ((s: string) => s);
    if (provided !== undefined) {
      const v = norm(provided);
      if (opt.validate && !opt.validate(v)) throw new Error(`invalid value for ${label}: "${provided}"`);
      return v;
    }
    if (!rl) throw new Error(`no config at ${configPath} and stdin is not a TTY — pass the setup flags or run interactively`);
    let v = '';
    do {
      v = norm(await ask(rl, label, opt.def));
    } while (!v || (opt.validate ? !opt.validate(v) : false));
    return v;
  }

  try {
    console.log('Setting up your Flow agent.\n');

    let agentToken: string;
    let agentUsername: string | undefined;
    let agentKey: string | undefined;
    let kind: string;

    if (opts.token) {
      // Reuse an existing agent: validate the token and skip registration.
      console.log('Verifying the agent token…');
      const me = await new FlowApi(serverUrl, opts.token).me();
      console.log(`Reconnecting as existing agent ${me.displayName} <@${me.id}>.\n`);
      agentToken = opts.token;
      kind = await required(opts.harness, 'Agent harness — claude, codex, or demo', {
        def: 'claude',
        normalize: (s) => s.toLowerCase(),
        validate: (s) => HARNESSES.includes(s),
      });
    } else {
      // Ask the four required items UP FRONT, then register (phase 15).
      const name = await required(opts.name, 'Agent name (shown in Flow, e.g. RepoBot)');
      const username = await required(opts.username, 'Handle (the agent’s @username — its durable login)', {
        def: slugify(name),
        normalize: (s) => s.toLowerCase(),
        validate: (s) => /^[a-z0-9][a-z0-9._-]{2,31}$/.test(s),
      });
      const sponsorEmail = await required(opts.sponsor, 'Sponsor email (YOUR Flow login — you approve and own this agent)', {
        validate: (s) => s.includes('@'),
      });
      kind = await required(opts.harness, 'Agent harness — claude, codex, or demo', {
        def: 'claude',
        normalize: (s) => s.toLowerCase(),
        validate: (s) => HARNESSES.includes(s),
      });
      const description = opts.description ?? '';

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
      // Optional; defaults to where `npx flow-agent-bridge` was run (usually the
      // repo checkout that IS the agent's identity). --cwd overrides.
      const cwd = path.resolve(expandHome(opts.cwd ?? '.'));
      if (!fs.existsSync(cwd)) throw new Error(`working directory does not exist: ${cwd} (pass --cwd)`);
      (config.runtime as Record<string, unknown>).cwd = cwd;
      // No allowedTools written: the default is full permissions in the cwd
      // (operator ruling) — add allowedTools/permissionMode to the saved config
      // to scope the agent down.
    }

    const abs = path.resolve(configPath);
    fs.writeFileSync(abs, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    console.log(`Saved ${abs} (contains the agent token and key — keep it private).`);
    console.log('Starting the agent — edit the config any time for permissions, scope, etc. (see AGENT_MEMBERS.md).\n');
    return abs;
  } finally {
    rl?.close();
  }
}
