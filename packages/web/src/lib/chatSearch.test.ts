import { describe, expect, it } from 'vitest';
import { matchLabel, matchRanges, stepIndex } from './chatSearch';

describe('matchRanges', () => {
  it('finds every occurrence, case-insensitively', () => {
    const hay = 'Deploy the deployer, then DEPLOY again';
    expect(matchRanges(hay, 'deploy').map((r) => hay.slice(r.start, r.end))).toEqual([
      'Deploy',
      'deploy',
      'DEPLOY',
    ]);
  });

  it('does not overlap matches', () => {
    expect(matchRanges('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it('matches nothing for an empty query', () => {
    expect(matchRanges('anything at all', '')).toEqual([]);
  });

  it('returns offsets that still index the original text', () => {
    // 'İ' lowercases to two codepoints; folding would slide every later
    // offset one place left, so this case falls back to a case-sensitive scan
    // rather than highlighting the wrong characters.
    const hay = 'İstanbul run';
    for (const r of matchRanges(hay, 'run')) expect(hay.slice(r.start, r.end)).toBe('run');
  });
});

describe('stepIndex', () => {
  it('wraps forward past the last match', () => {
    expect(stepIndex(2, 3, 1)).toBe(0);
  });

  it('wraps backward before the first', () => {
    expect(stepIndex(0, 3, -1)).toBe(2);
  });

  it('starts at the first match forward and the last backward', () => {
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
  });

  it('stays put with nothing to step through', () => {
    expect(stepIndex(-1, 0, 1)).toBe(-1);
    expect(stepIndex(-1, 0, -1)).toBe(-1);
  });
});

describe('matchLabel', () => {
  it('counts from one', () => {
    expect(matchLabel(0, 4)).toBe('1/4');
    expect(matchLabel(3, 4)).toBe('4/4');
  });

  it('says 0/0 rather than going quiet when nothing matched', () => {
    expect(matchLabel(-1, 0)).toBe('0/0');
  });
});
