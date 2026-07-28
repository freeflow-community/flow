import { beforeEach, describe, expect, it } from 'vitest';
import { PENDING_JOIN_KEY, clearJoinToken, parseJoinPath, readJoinToken, stashJoinToken } from './joinLink';

const TOKEN = 'a'.repeat(43); // base64url of 32 random bytes

// Vitest runs these in node, which has no localStorage.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

describe('parseJoinPath', () => {
  it('pulls the token out of /join/<slug>/<token>', () => {
    expect(parseJoinPath(`/join/acme/${TOKEN}`)).toBe(TOKEN);
    expect(parseJoinPath(`/join/acme-hq-2/${TOKEN}`)).toBe(TOKEN);
  });

  it('tolerates a trailing slash (link pasted from a doc)', () => {
    expect(parseJoinPath(`/join/acme/${TOKEN}/`)).toBe(TOKEN);
  });

  it('ignores paths that are not join links', () => {
    expect(parseJoinPath('/')).toBeNull();
    expect(parseJoinPath(`/invite/${TOKEN}`)).toBeNull();
    expect(parseJoinPath('/join/acme')).toBeNull();
    expect(parseJoinPath(`/join/${TOKEN}`)).toBeNull();
    expect(parseJoinPath(`/join/acme/${TOKEN}/extra`)).toBeNull();
  });

  it('rejects a token that could not be one (too short, wrong alphabet)', () => {
    expect(parseJoinPath('/join/acme/short')).toBeNull();
    expect(parseJoinPath(`/join/acme/${'a'.repeat(42)}$`)).toBeNull();
  });
});

describe('the pending-join stash', () => {
  const DAY = 24 * 60 * 60 * 1000;
  beforeEach(() => store.clear());

  it('round-trips a token', () => {
    stashJoinToken(TOKEN);
    expect(readJoinToken()).toBe(TOKEN);
    clearJoinToken();
    expect(readJoinToken()).toBeNull();
  });

  it('expires a token nobody came back for, so it cannot hijack a later visit', () => {
    const t0 = 1_000_000;
    stashJoinToken(TOKEN, t0);
    expect(readJoinToken(t0 + DAY - 1)).toBe(TOKEN);
    expect(readJoinToken(t0 + DAY + 1)).toBeNull();
    // and it's gone, not just hidden
    expect(store.get(PENDING_JOIN_KEY)).toBeUndefined();
  });

  it('honours a bare token from before the stash carried a timestamp', () => {
    store.set(PENDING_JOIN_KEY, TOKEN);
    expect(readJoinToken()).toBe(TOKEN);
  });

  it('drops an unreadable stash instead of wedging every load', () => {
    store.set(PENDING_JOIN_KEY, '{not json');
    expect(readJoinToken()).toBeNull();
    expect(store.get(PENDING_JOIN_KEY)).toBeUndefined();
  });
});
