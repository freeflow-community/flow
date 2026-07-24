// Interactive first-run setup (AGENT_MEMBERS.md): onboard the agent with a
// one-time invite code and hand back a ready-to-run agent.json. The streamlined
// flow (phase 15) asks only what a person must decide — the invite code (usually
// passed as the positional arg), then agent name, handle, harness — and redeems
// the code to join immediately (no sponsor approval; the code carries the
// sponsor + workspace). Everything else (server URL, an existing token to
// reuse, a description, the working directory) has a sensible default and is
// overridable with a CLI flag. Advanced knobs (permissionMode, allowedTools,
// eventScope, …) are edited in the saved file.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { FlowApi, newAgentKey, redeemAgentInvite } from './api.js';
import { expandHome } from './config.js';

/** Optional values that skip their prompt when supplied as CLI flags. */
export interface SetupOptions {
  serverUrl?: string | undefined; // --server / --host
  token?: string | undefined; // --token: reuse an existing agent, skip onboarding
  invite?: string | undefined; // the invite code (positional arg or --invite)
  name?: string | undefined; // --name
  username?: string | undefined; // --username / --handle
  harness?: string | undefined; // --harness / --runtime
  description?: string | undefined; // --description
  cwd?: string | undefined; // --cwd
}

const HARNESSES = ['claude', 'codex', 'demo'];
const INVITE_CODE_RE = /^flow-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

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
      // Redeem a one-time invite code (phase 15). The code (usually the
      // positional arg) carries the sponsor + workspace; ask only name, handle,
      // and harness, then join immediately — no approval.
      const code = await required(opts.invite, 'Invite code (generate one in Flow → “Invite your Agent”)', {
        normalize: (s) => s.trim(),
        validate: (s) => INVITE_CODE_RE.test(s),
      });
      const name = await required(opts.name, 'Agent name (shown in Flow, e.g. RepoBot)');
      const username = await required(opts.username, 'Handle (the agent’s @username — its durable login)', {
        def: slugify(name),
        normalize: (s) => s.toLowerCase(),
        validate: (s) => /^[a-z0-9][a-z0-9._-]{2,31}$/.test(s),
      });
      kind = await required(opts.harness, 'Agent harness — claude, codex, or demo', {
        def: 'claude',
        normalize: (s) => s.toLowerCase(),
        validate: (s) => HARNESSES.includes(s),
      });
      const description = opts.description ?? '';

      const key = newAgentKey();
      console.log('\nJoining the workspace…');
      const res = await redeemAgentInvite(serverUrl, {
        code,
        username,
        key,
        name,
        ...(description ? { description } : {}),
      });
      console.log(`\njoined as ${res.user.displayName} <@${res.user.id}> in workspace "${res.workspace.name}"\n`);
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
