// GET /download/mac/:asset — the Sparkle auto-update surface.
//
// The route serves only an allowlisted set of names, so a caller can't turn it
// into a read primitive for arbitrary blob keys. That allowlist originally
// covered `appcast.xml` and `Flow-<ver>-<build>.zip` only, which silently
// excluded the binary deltas `generate_appcast` also writes into the feed:
// every delta-eligible updater 404'd and fell back to the full ~5 MB archive
// instead of ~500 KB. Nothing failed loudly, and nothing tested this route.
//
// These cases pin both halves — the shapes that must be served, and the
// shapes that must stay rejected.
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

process.env.FLOW_DATA_KEY ??= randomBytes(32).toString('base64');

const { buildApp } = await import('../src/app.js');
const app = buildApp();

/** A 404 from the allowlist is distinguishable from a 404 for a missing blob:
 * the former never reaches the store, so it reports 'unknown update asset'. */
async function assetStatus(name: string): Promise<{ status: number; rejected: boolean }> {
  const res = await app.inject({ method: 'GET', url: `/download/mac/${name}` });
  let rejected = false;
  try {
    rejected = JSON.parse(res.body)?.error?.message === 'unknown update asset';
  } catch {
    rejected = false;
  }
  return { status: res.statusCode, rejected };
}

describe('update-asset allowlist', () => {
  it('admits the feed', async () => {
    expect((await assetStatus('appcast.xml')).rejected).toBe(false);
  });

  it('admits full update archives', async () => {
    for (const name of ['Flow-2.2.0-287.zip', 'Flow-2.1.0-279.zip']) {
      expect((await assetStatus(name)).rejected, name).toBe(false);
    }
  });

  it('admits binary deltas — the regression this file exists for', async () => {
    // `Flow<to>-<from>.delta`: no hyphen after "Flow", so the archive pattern
    // never matched these and the feed advertised URLs the server refused.
    for (const name of ['Flow287-279.delta', 'Flow287-276.delta', 'Flow279-276.delta']) {
      expect((await assetStatus(name)).rejected, name).toBe(false);
    }
  });

  it('rejects traversal and arbitrary blob keys', async () => {
    for (const name of [
      '..%2F..%2Fmessages',
      'Flow.dmg',
      'appcast.xml.bak',
      'Flow-2.2.0-287.zip.enc',
      'notes.txt',
      'Flow287-279.delta.txt',
    ]) {
      const { rejected, status } = await assetStatus(name);
      expect(rejected || status === 404, `${name} must not be served`).toBe(true);
    }
  });
});
