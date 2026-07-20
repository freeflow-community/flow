// ui_nits: emoji search matches substrings of the shortcode, prefix hits first.
import { describe, expect, it } from 'vitest';
import { emojiMatches } from '@flow/shared';

describe('emojiMatches', () => {
  it('matches substrings, not just prefixes', () => {
    const codes = emojiMatches('heart', 20).map((m) => m.code);
    expect(codes).toContain('heart'); // prefix hit
    expect(codes).toContain('broken_heart'); // substring hit
    expect(codes).toContain('green_heart');
  });

  it('ranks prefix matches ahead of mid-name matches', () => {
    const codes = emojiMatches('heart', 20).map((m) => m.code);
    const firstSubstring = codes.findIndex((c) => !c.startsWith('heart'));
    const lastPrefix = codes.map((c) => c.startsWith('heart')).lastIndexOf(true);
    expect(lastPrefix).toBeLessThan(firstSubstring === -1 ? codes.length : firstSubstring + 1);
    expect(codes[0]).toBe('heart');
  });

  it('still honors the limit and empty query', () => {
    expect(emojiMatches('a', 3)).toHaveLength(3);
    expect(emojiMatches('')).toHaveLength(0);
  });

  it('finds mid-name-only hits that a prefix match would miss', () => {
    const codes = emojiMatches('check', 10).map((m) => m.code);
    expect(codes).toContain('white_check_mark');
  });
});
