// Streamlined setup (phase 15): the flag-driven, no-TTY paths that fail before
// any network call. The full happy path needs a live server (registration +
// approval), so it isn't unit-tested here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSetup } from '../src/setup.js';

describe('runSetup', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // vitest runs with a non-TTY stdin, so any missing required answer must fail
    // fast rather than hang on a prompt.
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it('refuses when a required answer is missing and there is no TTY', async () => {
    await expect(runSetup('/tmp/does-not-exist.json', {})).rejects.toThrow(/not a TTY/);
  });

  it('rejects an invalid harness flag before touching the network', async () => {
    await expect(
      runSetup('/tmp/does-not-exist.json', {
        name: 'RepoBot',
        username: 'repobot',
        sponsor: 'you@example.com',
        harness: 'bogus',
      }),
    ).rejects.toThrow(/invalid value for Agent harness/);
  });

  it('rejects an invalid handle flag before touching the network', async () => {
    await expect(
      runSetup('/tmp/does-not-exist.json', {
        name: 'RepoBot',
        username: 'x', // too short for the handle regex
        sponsor: 'you@example.com',
        harness: 'claude',
      }),
    ).rejects.toThrow(/invalid value for Handle/);
  });
});
