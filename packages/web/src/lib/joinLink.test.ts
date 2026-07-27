import { describe, expect, it } from 'vitest';
import { parseJoinPath } from './joinLink';

const TOKEN = 'a'.repeat(43); // base64url of 32 random bytes

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
