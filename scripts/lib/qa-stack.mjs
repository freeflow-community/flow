// Shared plumbing for `pnpm qa:up` / `pnpm qa:down`.
//
// The one invariant both halves are built around: a QA stack owns *only* what
// `qa:up` created — a Postgres database, one server process, a state
// directory, and (with `--sim`) a simulator it booted itself. Postgres and
// NATS are borrowed infrastructure and are never started or stopped here, and
// port 8787 belongs to whatever is already using it on this machine. `qa:down`
// reads this file's state and removes that list, nothing else.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const serverDir = path.join(repoRoot, 'packages', 'server');
export const stackDir = path.join(repoRoot, '.qa');
export const statePath = path.join(stackDir, 'stack.json');

/** Never ours, on any machine — the ticket's standing rule, enforced in code. */
export const RESERVED_PORTS = new Set([8787]);

export const ADMIN_DB_URL = process.env.QA_ADMIN_DATABASE_URL
  ?? 'postgres://flow:flow_dev@127.0.0.1:5442/postgres';

export const NATS_URL = process.env.NATS_URL ?? 'nats://127.0.0.1:4222';

/** `postgres` is a dependency of @flow/server, not of the repo root. */
export async function postgresClient(url, opts = {}) {
  const require = createRequire(path.join(serverDir, 'package.json'));
  const mod = await import(pathToFileURL(require.resolve('postgres')).href);
  return (mod.default ?? mod)(url, { max: 1, onnotice: () => {}, ...opts });
}

export function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

export function writeState(state) {
  fs.mkdirSync(stackDir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

export function clearState() {
  fs.rmSync(statePath, { force: true });
}

/** Ask the kernel for a port nobody holds, then hand back the number. */
export async function freePort() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address();
        srv.close(() => resolve(port));
      });
    });
    if (!RESERVED_PORTS.has(port)) return port;
  }
  throw new Error('could not find a free port');
}

export function tcpOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.once('timeout', () => done(false));
  });
}

/** A Flow server answers /v1/me with 401. Anything else is not our server. */
export async function isFlowServer(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/v1/me`, { signal: AbortSignal.timeout(2000) });
    return res.status === 401;
  } catch {
    return false;
  }
}

export function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
