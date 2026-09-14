import { describe, it, expect } from 'vitest';
import {
  backTarget,
  canGoBack,
  canGoForward,
  emptyNavHistory,
  forgetNav,
  forwardTarget,
  pushNav,
  stepNav,
} from './navHistory';

const visit = (...ids: string[]) => ids.reduce(pushNav, emptyNavHistory);

describe('navHistory', () => {
  it('starts with both directions dead', () => {
    expect(canGoBack(emptyNavHistory)).toBe(false);
    expect(canGoForward(emptyNavHistory)).toBe(false);
  });

  it('a single visit is still an end of the line', () => {
    const h = visit('A');
    expect(canGoBack(h)).toBe(false);
    expect(canGoForward(h)).toBe(false);
  });

  it('walks back and forward through A → B → C', () => {
    let h = visit('A', 'B', 'C');
    expect(backTarget(h)).toBe('B');
    h = stepNav(h, -1);
    expect(backTarget(h)).toBe('A');
    h = stepNav(h, -1);
    expect(canGoBack(h)).toBe(false);
    expect(forwardTarget(h)).toBe('B');
    h = stepNav(h, 1);
    expect(forwardTarget(h)).toBe('C');
    h = stepNav(h, 1);
    expect(canGoForward(h)).toBe(false);
    expect(h.entries[h.index]).toBe('C');
  });

  it('collapses a re-visit of the view already showing', () => {
    const h = visit('A', 'B', 'B', 'B');
    expect(h.entries).toEqual(['A', 'B']);
  });

  it('re-visiting an *earlier* view is still a new entry', () => {
    const h = visit('A', 'B', 'A');
    expect(h.entries).toEqual(['A', 'B', 'A']);
    expect(backTarget(h)).toBe('B');
  });

  it('opening something new after going back discards the forward branch', () => {
    let h = visit('A', 'B', 'C');
    h = stepNav(h, -1); // back to B
    h = pushNav(h, 'D');
    expect(h.entries).toEqual(['A', 'B', 'D']);
    expect(canGoForward(h)).toBe(false);
    expect(backTarget(h)).toBe('B');
  });

  it('stepping past either end is a no-op', () => {
    const h = visit('A');
    expect(stepNav(h, -1)).toBe(h);
    expect(stepNav(h, 1)).toBe(h);
  });

  it('caps the stack and keeps the newest visits', () => {
    const h = visit(...Array.from({ length: 60 }, (_, i) => `c${i}`));
    expect(h.entries).toHaveLength(50);
    expect(h.entries[0]).toBe('c10');
    expect(h.entries[h.index]).toBe('c59');
  });

  it('forgets a channel that went away without moving the cursor off its view', () => {
    let h = visit('A', 'B', 'C');
    h = forgetNav(h, 'B');
    expect(h.entries).toEqual(['A', 'C']);
    expect(h.entries[h.index]).toBe('C');
    expect(backTarget(h)).toBe('A');
  });

  it('forgetting the current view falls back to the previous one', () => {
    const h = forgetNav(visit('A', 'B'), 'B');
    expect(h.entries).toEqual(['A']);
    expect(h.entries[h.index]).toBe('A');
  });

  it('forgetting every entry empties the history', () => {
    const h = forgetNav(visit('A', 'A'), 'A');
    expect(h.entries).toEqual([]);
    expect(h.index).toBe(-1);
    expect(canGoBack(h)).toBe(false);
  });

  it('leaves the history alone when the id was never visited', () => {
    const h = visit('A', 'B');
    expect(forgetNav(h, 'Z')).toBe(h);
  });
});
