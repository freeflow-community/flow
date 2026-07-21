// ui_nits: emoji search matches substrings of the shortcode, prefix hits first.
import { describe, expect, it } from 'vitest';
import { emojiMatches, expandShortcodes, EMOJI_SHORTCODES } from '@flow/shared';

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

  it('includes the newly added common Slack aliases', () => {
    // the ui_nits example plus a few representative additions
    expect(EMOJI_SHORTCODES.thread).toBe('🧵');
    expect(EMOJI_SHORTCODES.heavy_check_mark).toBe('✔️');
    expect(EMOJI_SHORTCODES.partying_face).toBe('🥳');
    expect(EMOJI_SHORTCODES.point_down).toBe('👇');
    // aliases resolve to the same glyph
    expect(EMOJI_SHORTCODES.satisfied).toBe(EMOJI_SHORTCODES.laughing);
    expect(EMOJI_SHORTCODES.fist).toBe(EMOJI_SHORTCODES.fist_raised);
    // and they surface in autocomplete
    expect(emojiMatches('thread', 8).map((m) => m.code)).toContain('thread');
  });
});

describe('expandShortcodes', () => {
  it('expands known :shortcode: tokens to unicode, including new aliases', () => {
    expect(expandShortcodes('reply in the :thread: please')).toBe('reply in the 🧵 please');
    expect(expandShortcodes(':heavy_check_mark: done')).toBe('✔️ done');
  });

  it('leaves unknown codes and bare colons untouched', () => {
    expect(expandShortcodes('ratio 3:2 and :not_an_emoji:')).toBe('ratio 3:2 and :not_an_emoji:');
    expect(expandShortcodes('no colons here')).toBe('no colons here');
  });

  it('is case-insensitive on the code', () => {
    expect(expandShortcodes(':THREAD:')).toBe('🧵');
  });
});
