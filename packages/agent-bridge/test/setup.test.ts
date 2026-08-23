// Streamlined setup (phase 15): the flag-driven, no-TTY paths that fail before
// any network call. The full happy path needs a live server (invite redemption),
// so it isn't unit-tested here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTemplate, runSetup } from '../src/setup.js';

const CODE = 'flow-AAAA-BBBB';

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

  it('rejects an invalid invite code before touching the network', async () => {
    await expect(
      runSetup('/tmp/does-not-exist.json', {
        invite: 'not-a-code',
        name: 'RepoBot',
        username: 'repobot',
        harness: 'claude',
      }),
    ).rejects.toThrow(/invalid value for Invite code/);
  });

  it('rejects an invalid harness flag before touching the network', async () => {
    await expect(
      runSetup('/tmp/does-not-exist.json', {
        invite: CODE,
        name: 'RepoBot',
        username: 'repobot',
        harness: 'bogus',
      }),
    ).rejects.toThrow(/invalid value for Agent harness/);
  });

  it('rejects a malformed agent.example.json before touching the network', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-setup-'));
    fs.writeFileSync(path.join(dir, 'agent.example.json'), '{not json');
    await expect(runSetup(path.join(dir, 'agent.json'), { invite: CODE })).rejects.toThrow(/agent\.example\.json/);
  });

  it('rejects a non-object agent.example.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-setup-'));
    fs.writeFileSync(path.join(dir, 'agent.example.json'), '[1,2]');
    expect(() => loadTemplate(path.join(dir, 'agent.json'))).toThrow(/JSON object/);
  });

  it('agent.example.json seeds name/handle/harness, so no TTY is needed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-setup-'));
    fs.writeFileSync(
      path.join(dir, 'agent.example.json'),
      JSON.stringify({
        // Unreachable server: the run must get past every prompt (which would
        // throw "not a TTY") and die on the network call instead.
        serverUrl: 'http://127.0.0.1:9',
        name: 'Prism',
        username: 'prism',
        runtime: { kind: 'claude', cwd: dir },
      }),
    );
    const err = await runSetup(path.join(dir, 'agent.json'), { invite: CODE }).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).not.toBeNull();
    expect(err!.message).not.toMatch(/not a TTY/);
  });

  it('rejects an invalid handle flag before touching the network', async () => {
    await expect(
      runSetup('/tmp/does-not-exist.json', {
        invite: CODE,
        name: 'RepoBot',
        username: 'x', // too short for the handle regex
        harness: 'claude',
      }),
    ).rejects.toThrow(/invalid value for Handle/);
  });
});
