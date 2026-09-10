#!/usr/bin/env node
// `pnpm qa:up` — one command between a clean checkout and a signed-in client.
//
// Brings up a throwaway Flow stack: a free port, its own Postgres database,
// the standard QA fixtures (Alice/Bob/Scott in the "QA Lab" workspace), and a
// pre-authed way into every client, so a QA run never drives the auth screen
// or the workspace picker by hand. Everything it creates is recorded in
// .qa/stack.json for `pnpm qa:down` to remove.
//
// Usage:
//   pnpm qa:up                 # start (or print the running stack)
//   pnpm qa:up --name=b        # a *second*, independent backend alongside it
//   pnpm qa:up --collide       # …seeded with ids that collide with every other
//                              #   --collide stack (the multi-server matrix)
//   pnpm qa:up --allow-origin=http://127.0.0.1:5051
//                              # let a web client hosted on that origin connect
//   pnpm qa:up --fresh         # tear the current stack down first
//   pnpm qa:up --sim           # also boot an iOS simulator
//   pnpm qa:up --sim="iPhone 17 Pro"
//   pnpm qa:up --web           # (re)build the web client into packages/web/dist
//   pnpm qa:up --json          # machine-readable summary on stdout
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  ADMIN_DB_URL,
  DEFAULT_STACK,
  NATS_URL,
  claimedPorts,
  freePort,
  isFlowServer,
  postgresClient,
  processAlive,
  readState,
  repoRoot,
  serverDir,
  sleep,
  stackDir,
  stackName,
  tcpOpen,
  writeState,
} from './lib/qa-stack.mjs';

const args = process.argv.slice(2);
const has = (name) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const opts = {
  name: stackName(value('name')),
  collide: has('collide'),
  allowOrigin: args.filter((a) => a.startsWith('--allow-origin='))
    .map((a) => a.slice('--allow-origin='.length)).join(','),
  fresh: has('fresh'),
  sim: has('sim'),
  simDevice: value('sim') || 'iPhone 17 Pro',
  web: has('web'),
  json: has('json'),
};

const log = (...m) => opts.json || console.log(...m);
const fail = (msg) => {
  console.error(`qa:up: ${msg}`);
  process.exit(1);
};

// ---- an already-running stack ------------------------------------------
const label = opts.name === DEFAULT_STACK ? '' : ` "${opts.name}"`;
const down = opts.name === DEFAULT_STACK ? 'pnpm qa:down' : `pnpm qa:down --name=${opts.name}`;
const existing = readState(opts.name);
if (existing && processAlive(existing.pid) && !opts.fresh) {
  if (await isFlowServer(existing.api)) {
    log(`qa:up: stack${label} is already running on port ${existing.port} — reusing it.`);
    log(`       \`${down.replace('down', 'up')} --fresh\` replaces it, \`${down}\` removes it.\n`);
    print(existing);
    process.exit(0);
  }
}
if (existing) {
  log('qa:up: removing the previous stack first…');
  const removed = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'qa-down.mjs'), `--name=${opts.name}`],
    { stdio: opts.json ? 'ignore' : 'inherit' },
  );
  if (removed.status !== 0) fail(`could not tear down the previous stack — run \`${down}\``);
}

// ---- preflight: borrowed infrastructure --------------------------------
// Started and stopped by docker compose, not by us: a QA stack that killed the
// database would take every other stack (and the dev server) with it.
const natsPort = Number(new URL(NATS_URL).port || 4222);
const pgUrl = new URL(ADMIN_DB_URL);
if (!(await tcpOpen(pgUrl.hostname, Number(pgUrl.port || 5432)))) {
  fail(`no Postgres at ${pgUrl.host} — start it with\n`
    + '  docker compose -f packages/infra/docker-compose.yml up -d');
}
if (!(await tcpOpen('127.0.0.1', natsPort))) {
  fail(`no NATS at 127.0.0.1:${natsPort} — start it with\n`
    + '  docker compose -f packages/infra/docker-compose.yml up -d');
}

// ---- workspace builds --------------------------------------------------
// @flow/shared is consumed through its dist/, by the server as well as the web
// client, and the server serves packages/web/dist when it exists — without it
// the browser half of the stack has nothing to open. Both are gitignored, so a
// fresh worktree needs them built once; after that this is a no-op.
const sharedDist = path.join(repoRoot, 'packages', 'shared', 'dist', 'index.js');
const webDist = path.join(repoRoot, 'packages', 'web', 'dist', 'index.html');
if (opts.web || !fs.existsSync(sharedDist) || !fs.existsSync(webDist)) {
  log('qa:up: building @flow/shared + the web client (first run in this worktree, or --web)…');
  // `@flow/web...` is web *and its workspace dependencies*, which is what pulls
  // @flow/shared in — building web alone fails on the missing dist.
  const build = spawnSync('pnpm', ['--filter', '@flow/web...', 'build'], {
    cwd: repoRoot,
    stdio: opts.json ? 'ignore' : 'inherit',
  });
  if (build.status !== 0) fail('web build failed');
}

// ---- the stack ---------------------------------------------------------
// Only the *listening* ports are visible to the kernel; a sibling stack that
// is still starting has claimed its number without binding it yet.
const port = await freePort(claimedPorts(opts.name));
const api = `http://127.0.0.1:${port}`;
const runDir = path.join(stackDir, `run-${port}`);
const dbName = `flow_qa_${port}`;
const dbUrl = new URL(ADMIN_DB_URL);
dbUrl.pathname = `/${dbName}`;

fs.mkdirSync(runDir, { recursive: true });

log(`qa:up: creating database ${dbName}…`);
{
  const sql = await postgresClient(ADMIN_DB_URL);
  try {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    await sql.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await sql.end();
  }
}

const env = {
  ...process.env,
  PORT: String(port),
  HOST: '127.0.0.1',
  DATABASE_URL: dbUrl.href,
  NATS_URL,
  // Signin links and invite mails have to point at *this* server, not 8787.
  FLOW_WEB_URL: api,
  // Per-stack scratch state, so nothing lands in the shared dev directories.
  FLOW_DATA_KEY_FILE: path.join(runDir, 'data.key.json'),
  FLOW_EMAIL_OUTBOX: path.join(runDir, 'emails'),
  FLOW_PUSH_OUTBOX: path.join(runDir, 'push'),
  FLOW_FILE_DIR: path.join(runDir, 'files'),
  // Its own NATS subject namespace. The bus routes on `ws.{workspaceId}…`,
  // and a `--collide` stack shares those ids with every other one by design —
  // on the shared dev NATS that means each stack's events surface in the
  // other's clients, which looks exactly like the cross-server leak the
  // acceptance matrix is hunting for. One prefix per stack removes the
  // harness from the experiment.
  FLOW_BUS_PREFIX: `qa${port}`,
  // Browser connections from another backend's page origin (the multi-server
  // shape: one web deployment, several backends). Same-origin needs no entry,
  // so bring the *page's* stack up first and pass its origin here.
  ...(opts.allowOrigin ? { FLOW_ALLOWED_WEB_ORIGINS: opts.allowOrigin } : {}),
};

const logPath = path.join(runDir, 'server.log');
const logFd = fs.openSync(logPath, 'a');
// Not `pnpm exec tsx`: those wrappers put two processes between us and the
// server, and killing the wrapper orphans the listener. `node --import tsx`
// is the server itself, in its own process group, so qa:down kills the group.
const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: serverDir,
  env,
  detached: true,
  stdio: ['ignore', logFd, logFd],
});
child.unref();

log(`qa:up: starting the server on ${api} (pid ${child.pid})…`);
let up = false;
for (let i = 0; i < 120 && !up; i++) {
  if (!processAlive(child.pid)) break;
  up = await isFlowServer(api);
  if (!up) await sleep(500);
}
if (!up) {
  console.error(fs.readFileSync(logPath, 'utf8').split('\n').slice(-30).join('\n'));
  fail(`server did not come up on ${api} — log at ${logPath}`);
}

// ---- fixtures ----------------------------------------------------------
log('qa:up: seeding QA fixtures…');
const seeded = spawnSync(process.execPath, [path.join(serverDir, 'scripts', 'qa-seed.mjs')], {
  cwd: serverDir,
  env: { ...process.env, API: api },
  encoding: 'utf8',
});
if (seeded.status !== 0) {
  console.error(seeded.stderr);
  fail('seeding failed');
}
let seed = JSON.parse(seeded.stdout);

// ---- deliberate id collisions (multi-server acceptance) ----------------
// Every `--collide` stack derives its user/workspace/channel/file ids from the
// row's natural key, so two independently seeded backends end up sharing them.
// That is the point: the spec's acceptance matrix runs against "two independent
// backends with deliberately overlapping identifiers", and nothing else on this
// machine produces that.
if (opts.collide) {
  log('qa:up: rewriting ids so they collide with every other --collide stack…');
  const collided = spawnSync(
    process.execPath,
    [path.join(serverDir, 'scripts', 'qa-collide.mjs'), `--database-url=${dbUrl.href}`],
    { cwd: serverDir, encoding: 'utf8' },
  );
  if (collided.status !== 0) {
    console.error(collided.stderr);
    fail('id collision rewrite failed');
  }
  // The tokens the seed printed still identify their sessions, but the ids in
  // its JSON are the pre-rewrite ones. Re-read them through the API.
  const reread = spawnSync(process.execPath, [path.join(serverDir, 'scripts', 'qa-seed.mjs')], {
    cwd: serverDir, env: { ...process.env, API: api }, encoding: 'utf8',
  });
  if (reread.status !== 0) {
    console.error(reread.stderr);
    fail('re-seeding after the collision rewrite failed');
  }
  seed = JSON.parse(reread.stdout);
}
fs.writeFileSync(path.join(runDir, 'seed.json'), JSON.stringify(seed, null, 2) + '\n');

// ---- pre-auth ----------------------------------------------------------
// Two handoffs the product already speaks, so nothing here is a test-only
// backdoor: `flow://signin?code=` is the web-to-app code exchange the native
// clients use, and `?signin=` is the emailed passwordless link the web client
// consumes on load. Both land signed in as Alice, in the QA Lab workspace.
async function appLinkFor(token) {
  const res = await fetch(`${api}/v1/auth/app-link`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`app-link failed: ${res.status}`);
  return (await res.json()).code;
}

async function webSigninLinkFor(email) {
  const before = new Set(listOutbox());
  const res = await fetch(`${api}/v1/auth/signin-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`signin-link failed: ${res.status}`);
  // The dev mailer writes the message as JSON; the link is in its body.
  for (let i = 0; i < 40; i++) {
    const fresh = listOutbox().filter((f) => !before.has(f));
    if (fresh.length) {
      const msg = JSON.parse(fs.readFileSync(path.join(env.FLOW_EMAIL_OUTBOX, fresh[0]), 'utf8'));
      const link = msg.text.match(/https?:\/\/\S+/)?.[0];
      if (link) return link;
    }
    await sleep(250);
  }
  throw new Error('no signin mail landed in the dev outbox');
}

function listOutbox() {
  try {
    return fs.readdirSync(env.FLOW_EMAIL_OUTBOX).sort().reverse();
  } catch {
    return [];
  }
}

const appLinkCode = await appLinkFor(seed.alice.token);
const webSigninUrl = await webSigninLinkFor(seed.alice.email);

// ---- optional simulator ------------------------------------------------
let sim = null;
if (opts.sim) {
  const booted = simList().find((d) => d.state === 'Booted');
  if (booted) {
    log(`qa:up: simulator "${booted.name}" is already booted — leaving it alone.`);
    sim = { udid: booted.udid, name: booted.name, bootedByUs: false };
  } else {
    const device = simList().find((d) => d.name === opts.simDevice) ?? simList()[0];
    if (!device) fail('no iOS simulators available');
    log(`qa:up: booting simulator "${device.name}"…`);
    spawnSync('xcrun', ['simctl', 'boot', device.udid], { stdio: 'ignore' });
    spawnSync('open', ['-a', 'Simulator'], { stdio: 'ignore' });
    sim = { udid: device.udid, name: device.name, bootedByUs: true };
  }
}

function simList() {
  const out = spawnSync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], {
    encoding: 'utf8',
  });
  if (out.status !== 0) return [];
  const runtimes = JSON.parse(out.stdout).devices ?? {};
  return Object.entries(runtimes)
    .filter(([runtime]) => runtime.includes('iOS'))
    .flatMap(([, devices]) => devices)
    .filter((d) => d.isAvailable !== false);
}

// ---- record and report -------------------------------------------------
const state = {
  startedAt: new Date().toISOString(),
  name: opts.name,
  collided: opts.collide,
  allowedWebOrigins: opts.allowOrigin ? opts.allowOrigin.split(',') : [],
  port,
  api,
  ws: `ws://127.0.0.1:${port}/v1/ws`,
  pid: child.pid,
  dbName,
  databaseUrl: dbUrl.href,
  adminDatabaseUrl: ADMIN_DB_URL,
  runDir,
  logPath,
  seedPath: path.join(runDir, 'seed.json'),
  emailOutbox: env.FLOW_EMAIL_OUTBOX,
  pushOutbox: env.FLOW_PUSH_OUTBOX,
  workspace: { id: seed.workspaceId, slug: seed.workspaceSlug, name: seed.workspaceName },
  generalChannelId: seed.generalChannelId,
  users: {
    alice: { email: seed.alice.email, userId: seed.alice.userId, token: seed.alice.token },
    bob: { email: seed.bob.email, userId: seed.bob.userId, token: seed.bob.token },
    scott: { email: seed.scott.email, userId: seed.scott.userId, token: seed.scott.token },
  },
  password: seed.password,
  preAuth: {
    appLink: `flow://signin?code=${appLinkCode}`,
    webUrl: webSigninUrl,
    // The signin link lands on the workspace picker, because the web client
    // only auto-selects a workspace it has been in before. Pasting this in the
    // browser console skips both screens; changing the picker's behaviour
    // would be a product change, which a dev tool does not get to make.
    webConsole:
      `localStorage.setItem('flow.token', '${seed.alice.token}');`
      + `localStorage.setItem('flow.activeWorkspace', '${seed.workspaceId}');`
      + `location.href = '${api}/'`,
  },
  sim,
};
writeState(state, opts.name);

if (opts.json) {
  console.log(JSON.stringify(state, null, 2));
} else {
  print(state);
}

function print(s) {
  const line = (k, v) => console.log(`  ${k.padEnd(18)} ${v}`);
  const title = s.name && s.name !== DEFAULT_STACK ? `QA stack "${s.name}" up` : 'QA stack up';
  console.log(`\n── ${title} ${'─'.repeat(Math.max(1, 58 - title.length))}`);
  line('API / web', s.api);
  line('WebSocket', s.ws);
  line('database', s.dbName);
  line('server log', s.logPath);
  console.log('\n  Fixtures');
  line('workspace', `${s.workspace.name} (${s.workspace.slug})`);
  line('accounts', `${s.users.alice.email} / ${s.users.bob.email} / ${s.users.scott.email}`);
  line('password', s.password);
  line('tokens', s.seedPath);
  console.log('\n  Signed in as Alice, no auth screen');
  line('web', s.preAuth.webUrl);
  line('macOS / iOS', `open "${s.preAuth.appLink}"`);
  console.log('  …and to skip the workspace picker too, paste in the browser console:');
  console.log(`    ${s.preAuth.webConsole}`);
  console.log('\n  Point a client or a test at this stack');
  line('macOS app', `FLOW_SERVER_URL=${s.api} apps/macos/tools/make-app.sh && open dist/Flow.app`);
  line('swift test', `FLOW_TEST_SERVER_URL=${s.api} swift test`);
  line('scripts', `API=${s.api} node packages/server/scripts/qa-bot.mjs`);
  if (s.sim) line('simulator', `${s.sim.name} (${s.sim.udid})`);
  if (s.collided) console.log('\n  ids collide with every other --collide stack (multi-server matrix)');
  if (s.allowedWebOrigins?.length) console.log(`  browser origins allowed: ${s.allowedWebOrigins.join(', ')}`);
  const remove = s.name && s.name !== DEFAULT_STACK ? `pnpm qa:down --name=${s.name}` : 'pnpm qa:down';
  console.log(`\n  ${remove} removes exactly this stack.`);
  console.log('──────────────────────────────────────────────────────────────\n');
}
