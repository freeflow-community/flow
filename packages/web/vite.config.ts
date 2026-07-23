import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Readable build tag `MMDD.N`: month-day of the HEAD commit plus a per-day
// index (how many commits landed that calendar day), e.g. `0722.27`. Derived
// from git so it needs no manual bookkeeping and increments on every release;
// `BUILD_NUMBER`/`BUILD_SHA` env vars override it for CI where .git may be
// absent. Falls back to `dev` outside a checkout. Injected via `define` and
// read as the `__BUILD__` / `__BUILD_SHA__` globals (see src/vite-env.d.ts).
function gitBuildNumber(): string {
  if (process.env.BUILD_NUMBER) return process.env.BUILD_NUMBER;
  try {
    const date = execSync('git show -s --format=%cd --date=format:%Y-%m-%d HEAD').toString().trim();
    const mmdd = date.slice(5).replace('-', ''); // 2026-07-22 -> 0722
    const idx = execSync(
      `git rev-list --count HEAD --since="${date} 00:00:00" --until="${date} 23:59:59"`,
    )
      .toString()
      .trim();
    return `${mmdd}.${idx}`;
  } catch {
    return 'dev';
  }
}

function gitBuildSha(): string {
  if (process.env.BUILD_SHA) return process.env.BUILD_SHA;
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return '';
  }
}

// Dev: Vite serves the SPA and proxies API + WS to the local backend so the
// client is same-origin in both dev and prod (prod = Fastify static serving).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD__: JSON.stringify(gitBuildNumber()),
    __BUILD_SHA__: JSON.stringify(gitBuildSha()),
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:8787',
        ws: true, // /v1/ws WebSocket upgrade
      },
      '/healthz': 'http://127.0.0.1:8787',
    },
  },
});
