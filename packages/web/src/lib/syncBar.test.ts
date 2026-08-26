import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncBarTimer } from './syncBar';

// The reconnect bar's timing (#234). The point of the two numbers is that a
// brief drop is invisible rather than a flash, so that is what these assert.
describe('SyncBarTimer', () => {
  let clock = 0;
  const now = () => clock;
  const advance = (ms: number) => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  };

  beforeEach(() => {
    clock = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const seen: boolean[] = [];
    const timer = new SyncBarTimer((v) => seen.push(v), { showDelay: 250, minVisible: 500, now });
    return { timer, seen };
  };

  it('draws nothing for a reconnect that resolves inside the delay', () => {
    const { timer, seen } = make();
    timer.update(true);
    advance(200);
    timer.update(false);
    advance(1000);
    expect(seen).toEqual([]);
  });

  it('shows the bar once syncing outlasts the delay', () => {
    const { timer, seen } = make();
    timer.update(true);
    advance(249);
    expect(seen).toEqual([]);
    advance(1);
    expect(seen).toEqual([true]);
  });

  it('holds a shown bar for the minimum duration', () => {
    const { timer, seen } = make();
    timer.update(true);
    advance(300); // shown at 250
    timer.update(false); // only 50ms on screen
    advance(400);
    expect(seen).toEqual([true]); // still held
    advance(100); // 500ms since it appeared
    expect(seen).toEqual([true, false]);
  });

  it('cancels a pending hide when syncing resumes', () => {
    const { timer, seen } = make();
    timer.update(true);
    advance(300);
    timer.update(false);
    timer.update(true); // dropped again straight away
    advance(2000);
    expect(seen).toEqual([true]);
  });

  it('stops reporting after dispose', () => {
    const { timer, seen } = make();
    timer.update(true);
    timer.dispose();
    advance(1000);
    expect(seen).toEqual([]);
  });
});
