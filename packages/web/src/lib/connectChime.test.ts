import { afterEach, describe, expect, it, vi } from 'vitest';
import { playConnectChime } from './connectChime';

interface FakeOsc {
  type: string;
  frequency: { value: number };
  started: number | null;
  stopped: number | null;
  connect(node: unknown): unknown;
  start(at: number): void;
  stop(at: number): void;
}

function fakeAudio() {
  const oscillators: FakeOsc[] = [];
  const gainNode = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  class FakeContext {
    currentTime = 0;
    destination = {};
    closed = false;
    resume = vi.fn();
    close = vi.fn(() => {
      this.closed = true;
    });
    createGain() {
      return gainNode;
    }
    createOscillator(): FakeOsc {
      const osc: FakeOsc = {
        type: '',
        frequency: { value: 0 },
        started: null,
        stopped: null,
        connect: () => gainNode,
        start(at: number) {
          osc.started = at;
        },
        stop(at: number) {
          osc.stopped = at;
        },
      };
      oscillators.push(osc);
      return osc;
    }
  }
  return { oscillators, FakeContext };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('playConnectChime', () => {
  it('plays a short two-note tone through Web Audio', () => {
    const { oscillators, FakeContext } = fakeAudio();
    (globalThis as { window?: unknown }).window = { AudioContext: FakeContext, setTimeout: vi.fn() };

    playConnectChime();

    expect(oscillators).toHaveLength(2);
    expect(oscillators.map((o) => o.frequency.value)).toEqual([660, 990]);
    for (const osc of oscillators) {
      expect(osc.type).toBe('sine');
      expect(osc.started).not.toBeNull();
      // Well under a second, per #509 — this lands mid-call.
      expect(osc.stopped! - osc.started!).toBeLessThan(0.5);
    }
  });

  it('is a no-op where there is no Web Audio, rather than taking the call down', () => {
    (globalThis as { window?: unknown }).window = { setTimeout: vi.fn() };
    expect(() => playConnectChime()).not.toThrow();
  });

  it('swallows a browser that refuses to build a context', () => {
    (globalThis as { window?: unknown }).window = {
      AudioContext: class {
        constructor() {
          throw new Error('blocked');
        }
      },
      setTimeout: vi.fn(),
    };
    expect(() => playConnectChime()).not.toThrow();
  });
});
