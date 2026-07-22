// Startup freshness check: compare our installed version against the latest
// published on the npm registry so the bridge can warn when it's stale.
// Best-effort — every failure (offline, registry down, unparseable) is
// swallowed by the caller; a version check must never wedge startup.
import fs from 'node:fs';

const REGISTRY_URL = 'https://registry.npmjs.org/flow-agent-bridge/latest';

/** Our own installed version, read from the package.json shipped beside dist/ (or src/ in dev). */
export function currentVersion(): string {
  // version.ts → dist/version.js (prod) or src/version.ts (tsx dev); package.json is one level up in both.
  const pkgUrl = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(fs.readFileSync(pkgUrl, 'utf8')) as { version?: string };
  if (!pkg.version) throw new Error('package.json has no version');
  return pkg.version;
}

/** Latest published version from npm, or null if the registry can't be reached in time. */
export async function latestPublishedVersion(timeoutMs = 5000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return body.version ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a semver core (major.minor.patch); prerelease/build metadata is ignored for ordering. */
function parse(v: string): [number, number, number] | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is strictly newer than `current` (both x.y.z); false if either is unparseable. */
export function isOutdated(current: string, latest: string): boolean {
  const a = parse(current);
  const b = parse(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (b[i]! > a[i]!) return true;
    if (b[i]! < a[i]!) return false;
  }
  return false;
}
