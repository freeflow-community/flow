import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { burstConfetti, celebrationsAdded, resetCelebrationMemory } from './confetti';

describe('celebrationsAdded', () => {
  beforeEach(() => resetCelebrationMemory());

  it('stays silent the first time it sees a message', () => {
    // Channel load and scrollback: the 🎉 is history, not a celebration.
    expect(celebrationsAdded('m1', [{ emoji: '🎉', count: 3 }])).toEqual([]);
  });

  it('fires when a celebration count goes up on a message it has seen', () => {
    celebrationsAdded('m1', []);
    expect(celebrationsAdded('m1', [{ emoji: '🎉', count: 1 }])).toEqual(['🎉']);
    expect(celebrationsAdded('m1', [{ emoji: '🎉', count: 2 }])).toEqual(['🎉']);
  });

  it('fires for 🎊 as well', () => {
    celebrationsAdded('m1', []);
    expect(celebrationsAdded('m1', [{ emoji: '🎊', count: 1 }])).toEqual(['🎊']);
  });

  it('stays silent on an unchanged count', () => {
    celebrationsAdded('m1', [{ emoji: '🎉', count: 1 }]);
    expect(celebrationsAdded('m1', [{ emoji: '🎉', count: 1 }])).toEqual([]);
  });

  it('stays silent when the reaction is removed, and again when it returns to a lower count', () => {
    celebrationsAdded('m1', []);
    celebrationsAdded('m1', [{ emoji: '🎉', count: 2 }]);
    expect(celebrationsAdded('m1', [{ emoji: '🎉', count: 1 }])).toEqual([]);
    expect(celebrationsAdded('m1', [])).toEqual([]);
  });

  it('ignores emoji that are not celebrations', () => {
    celebrationsAdded('m1', []);
    expect(celebrationsAdded('m1', [{ emoji: '👍', count: 1 }])).toEqual([]);
  });

  it('tracks messages independently', () => {
    celebrationsAdded('m1', []);
    expect(celebrationsAdded('m2', [{ emoji: '🎉', count: 1 }])).toEqual([]);
    expect(celebrationsAdded('m1', [{ emoji: '🎉', count: 1 }])).toEqual(['🎉']);
  });
});

interface FakeCanvas {
  width: number;
  height: number;
  style: { cssText: string };
  removed: boolean;
  setAttribute: (k: string, v: string) => void;
  getContext: () => unknown;
  remove: () => void;
}

function fakeDom({ reducedMotion = false, hasContext = true } = {}) {
  const fillRect = vi.fn();
  const ctx = {
    fillRect,
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setTransform: vi.fn(),
    globalAlpha: 1,
    fillStyle: '',
  };
  const canvases: FakeCanvas[] = [];
  const appended: FakeCanvas[] = [];
  const frames: FrameRequestCallback[] = [];
  const document = {
    createElement: () => {
      const el: FakeCanvas = {
        width: 0,
        height: 0,
        style: { cssText: '' },
        removed: false,
        setAttribute: () => {},
        getContext: () => (hasContext ? ctx : null),
        remove() {
          el.removed = true;
        },
      };
      canvases.push(el);
      return el;
    },
    body: { appendChild: (el: FakeCanvas) => appended.push(el) },
  };
  const window = {
    innerWidth: 1200,
    innerHeight: 800,
    devicePixelRatio: 2,
    matchMedia: (q: string) => ({ matches: reducedMotion && q.includes('reduced-motion') }),
  };
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});

  /** Drive the loop by hand: `n` frames `stepMs` apart. */
  const runFrames = (n: number, stepMs = 50) => {
    let t = 0;
    for (let i = 0; i < n; i++) {
      const cb = frames.shift();
      if (!cb) return;
      t += stepMs;
      cb(t);
    }
  };
  return { appended, canvases, ctx, fillRect, runFrames };
}

describe('burstConfetti', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('draws particles and cleans the canvas up once the burst is over', () => {
    const dom = fakeDom();
    burstConfetti(300, 400);
    const overlay = dom.appended[0];
    expect(dom.appended).toHaveLength(1);
    // Retina overlay sized in device pixels, drawing in CSS pixels.
    expect(overlay?.width).toBe(2400);
    expect(dom.ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);

    dom.runFrames(1);
    expect(dom.fillRect).toHaveBeenCalledTimes(26);

    // A particle lives ~1s; past that the overlay takes itself back down.
    dom.runFrames(30);
    expect(overlay?.removed).toBe(true);
  });

  it('caps the particle count so a pile-on stays cheap', () => {
    const dom = fakeDom();
    for (let i = 0; i < 20; i++) burstConfetti(300, 400);
    dom.runFrames(1);
    expect(dom.fillRect.mock.calls.length).toBeLessThanOrEqual(200);
    expect(dom.fillRect.mock.calls.length).toBeGreaterThan(100);
    // Let it finish so the module's canvas doesn't outlive these globals.
    dom.runFrames(30);
  });

  it('does nothing under prefers-reduced-motion', () => {
    const dom = fakeDom({ reducedMotion: true });
    burstConfetti(300, 400);
    expect(dom.canvases).toHaveLength(0);
    expect(dom.appended).toHaveLength(0);
  });

  it('does nothing when the browser gives no 2d context', () => {
    const dom = fakeDom({ hasContext: false });
    burstConfetti(300, 400);
    expect(dom.appended).toHaveLength(0);
  });
});
