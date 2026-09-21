// Build-time and run-time configuration of the shell.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

const here = path.dirname(fileURLToPath(import.meta.url)); // dist/main
export const distRoot = path.resolve(here, '..');          // dist
export const packageRoot = path.resolve(distRoot, '..');   // apps/desktop

const FALLBACK_SERVER = 'https://app.freeflow.im';

/** The server this build was made for. Baked by `scripts/bake-config.mjs`
 * into `dist/config.json`; a development run (not packaged) may override it
 * with `FLOW_SERVER_URL`, the same variable the macOS build script reads. */
export function defaultServerOrigin(): string {
  const env = process.env.FLOW_SERVER_URL?.trim().replace(/\/+$/, '');
  if (env && !app.isPackaged) return env;
  try {
    const baked = JSON.parse(readFileSync(path.join(distRoot, 'config.json'), 'utf8')) as { defaultServerOrigin?: string };
    if (typeof baked.defaultServerOrigin === 'string' && baked.defaultServerOrigin) return baked.defaultServerOrigin;
  } catch { /* no baked config: a bare `tsc` build */ }
  return FALLBACK_SERVER;
}

/** `FLOW_PROFILE`, sanitized the way `apps/macos/Sources/Flow/Support/Profile.swift`
 * does: a short name safe for a directory. Null when unset. */
export function profileName(): string | null {
  const raw = process.env.FLOW_PROFILE?.trim() ?? '';
  const clean = raw.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40);
  return clean || null;
}

/** The built web client the shell serves. A packaged app carries it in its
 * resources; a development run reads the workspace build next door, or
 * whatever `FLOW_WEB_DIST` points at. */
export function webRoot(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'web');
  const env = process.env.FLOW_WEB_DIST?.trim();
  if (env) return path.resolve(env);
  return path.resolve(packageRoot, '..', '..', 'packages', 'web', 'dist');
}
