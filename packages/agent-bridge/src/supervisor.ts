// The supervisor: the CLI's default entry no longer *is* the daemon — it
// spawns the daemon as a child (`run <config>` + FLOW_BRIDGE_SUPERVISED=1) and
// reacts to how the child exits. That is what lets the bridge update and
// restart itself on a chat command (`/update`, `/restart` — see bridge.ts):
// a process can't replace its own code, but its supervisor can.
//
//   exit 0            → clean stop; the supervisor exits too
//   exit EXIT_RESTART → respawn immediately
//   exit EXIT_UPDATE  → npm-install the latest package, then respawn
//   anything else     → a crash; respawn with escalating backoff
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Exit codes the daemon uses to ask for a relaunch. Chosen clear of the
 * codes node and the shells use (1, 2, 126–128+signal). */
export const EXIT_RESTART = 87;
export const EXIT_UPDATE = 88;

export type NextAction = 'exit' | 'respawn' | 'update';

/** What a child exit means for the supervisor. A signal-caused exit during
 * shutdown (or a clean 0) ends the loop; everything else keeps the daemon up. */
export function nextAction(code: number | null, shuttingDown: boolean): NextAction {
  if (shuttingDown || code === 0) return 'exit';
  if (code === EXIT_UPDATE) return 'update';
  return 'respawn';
}

/** Backoff for *crash* respawns (requested restarts are immediate): 1s, 5s,
 * 15s, then 60s forever. The counter resets after a healthy stretch. */
export function crashBackoffMs(consecutiveCrashes: number): number {
  const steps = [1_000, 5_000, 15_000, 60_000];
  return steps[Math.min(Math.max(consecutiveCrashes, 1), steps.length) - 1]!;
}

/** A child that stayed up this long was working; forget prior crashes. */
const HEALTHY_UPTIME_MS = 5 * 60_000;

/**
 * How this install can be updated. Our package root inside a `node_modules`
 * (global install, local install, and the npx cache all look the same) yields
 * the prefix `npm install --prefix` needs; anything else is a source checkout
 * npm must not touch — update by `git pull` + build there.
 */
export function updateTarget(pkgRoot: string): { mode: 'npm'; prefix: string } | { mode: 'checkout' } {
  const parent = path.dirname(pkgRoot);
  if (path.basename(parent) !== 'node_modules') return { mode: 'checkout' };
  return { mode: 'npm', prefix: path.dirname(parent) };
}

function ownPackageRoot(): string {
  // supervisor.ts → dist/supervisor.js (prod) or src/supervisor.ts (dev); the
  // package root is one level up in both.
  return path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
}

function log(msg: string): void {
  console.log(`[supervisor ${new Date().toISOString()}] ${msg}`);
}

/** `npm install flow-agent-bridge@latest` into this install's prefix.
 * Best-effort: a failed install logs and the old version respawns — the
 * daemon reports the unchanged version when it comes back. */
function runUpdate(): void {
  const target = updateTarget(ownPackageRoot());
  if (target.mode === 'checkout') {
    log('running from a source checkout — not npm-updating; git pull + build to update');
    return;
  }
  log(`updating: npm install flow-agent-bridge@latest --prefix ${target.prefix}`);
  const res = spawnSync(
    'npm',
    ['install', 'flow-agent-bridge@latest', '--prefix', target.prefix, '--no-fund', '--no-audit', '--loglevel=error'],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (res.status !== 0) log(`npm install failed (exit ${res.status ?? 'signal'}) — respawning the current version`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run the daemon under supervision until it exits cleanly (or we're told to
 * shut down). `argv1` is re-read each spawn so an update that replaced the
 * entry file takes effect on the next child.
 */
export async function runSupervisor(configPath: string): Promise<void> {
  let shuttingDown = false;
  let crashes = 0;
  let child: ReturnType<typeof spawn> | null = null;
  const forward = (sig: NodeJS.Signals): void => {
    shuttingDown = true;
    child?.kill(sig);
  };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));

  for (;;) {
    const startedAt = Date.now();
    child = spawn(process.execPath, [process.argv[1]!, 'run', configPath], {
      stdio: 'inherit',
      env: { ...process.env, FLOW_BRIDGE_SUPERVISED: '1' },
    });
    const code: number | null = await new Promise((resolve) => child!.on('exit', (c) => resolve(c)));
    if (Date.now() - startedAt > HEALTHY_UPTIME_MS) crashes = 0;

    switch (nextAction(code, shuttingDown)) {
      case 'exit':
        process.exit(code ?? 0);
        break;
      case 'update':
        runUpdate();
        log('respawning after update');
        break;
      case 'respawn':
        if (code === EXIT_RESTART) {
          log('restart requested — respawning');
        } else {
          crashes += 1;
          const wait = crashBackoffMs(crashes);
          log(`daemon exited unexpectedly (code ${code ?? 'signal'}) — respawning in ${wait / 1000}s`);
          await sleep(wait);
        }
        break;
    }
  }
}
