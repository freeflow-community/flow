#!/usr/bin/env node
// `pnpm qa:down` — remove exactly what `pnpm qa:up` created, and nothing else.
//
// Every destructive step is gated on .qa/stack.json: the port must not be a
// reserved one, the pid must still look like the server we started from this
// checkout, the database name must be one we minted, and a simulator is only
// shut down when we were the ones who booted it. A stack we did not start is
// not ours to stop — on this machine 8787 belongs to an unrelated app, and
// that is the failure mode this file exists to make impossible.
//
// Usage:
//   pnpm qa:down              # stop the server, drop its database, clean up
//   pnpm qa:down --keep-logs  # leave .qa/run-<port>/ on disk
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  RESERVED_PORTS,
  clearState,
  postgresClient,
  processAlive,
  readState,
  serverDir,
  sleep,
  statePath,
} from './lib/qa-stack.mjs';

const keepLogs = process.argv.includes('--keep-logs');
const state = readState();

if (!state) {
  console.log('qa:down: no QA stack recorded — nothing to do.');
  process.exit(0);
}

if (RESERVED_PORTS.has(state.port)) {
  console.error(`qa:down: refusing to touch port ${state.port} — it is not ours.`);
  process.exit(1);
}

// ---- the server --------------------------------------------------------
if (processAlive(state.pid)) {
  const cmd = spawnSync('ps', ['-o', 'command=', '-p', String(state.pid)], { encoding: 'utf8' })
    .stdout ?? '';
  // The pid could have been recycled since qa:up wrote it. Only kill something
  // that still looks like the server this checkout started.
  if (!cmd.includes(`${serverDir}/src/index.ts`) && !cmd.includes('src/index.ts')) {
    console.error(`qa:down: pid ${state.pid} is not our server any more — leaving it alone.`);
    console.error(`         ${cmd.trim()}`);
  } else {
    console.log(`qa:down: stopping the server on port ${state.port} (pid ${state.pid})…`);
    // qa:up spawned it detached, so the pid heads its own process group.
    try {
      process.kill(-state.pid, 'SIGTERM');
    } catch {
      try {
        process.kill(state.pid, 'SIGTERM');
      } catch { /* already gone */ }
    }
    for (let i = 0; i < 40 && processAlive(state.pid); i++) await sleep(250);
    if (processAlive(state.pid)) {
      try {
        process.kill(-state.pid, 'SIGKILL');
      } catch { /* already gone */ }
    }
  }
} else {
  console.log('qa:down: the server is already stopped.');
}

// ---- the database ------------------------------------------------------
if (/^flow_qa_\d+$/.test(state.dbName ?? '')) {
  console.log(`qa:down: dropping database ${state.dbName}…`);
  const sql = await postgresClient(state.adminDatabaseUrl);
  try {
    // A half-closed connection would keep the DROP waiting forever.
    await sql.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${state.dbName}'`,
    );
    await sql.unsafe(`DROP DATABASE IF EXISTS "${state.dbName}"`);
  } finally {
    await sql.end();
  }
} else if (state.dbName) {
  console.error(`qa:down: ${state.dbName} is not a qa:up database name — leaving it alone.`);
}

// ---- the simulator -----------------------------------------------------
if (state.sim?.bootedByUs) {
  console.log(`qa:down: shutting down simulator "${state.sim.name}"…`);
  spawnSync('xcrun', ['simctl', 'shutdown', state.sim.udid], { stdio: 'ignore' });
} else if (state.sim) {
  console.log(`qa:down: simulator "${state.sim.name}" was already booted — leaving it running.`);
}

// ---- the scratch directory --------------------------------------------
if (!keepLogs && state.runDir?.includes('/.qa/run-')) {
  fs.rmSync(state.runDir, { recursive: true, force: true });
} else if (state.runDir) {
  console.log(`qa:down: keeping ${state.runDir}`);
}

clearState();
console.log(`qa:down: done. (${statePath} removed)`);
