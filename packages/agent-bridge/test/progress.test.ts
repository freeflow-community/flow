// The "thinking…" progress indicator must be scoped to the composer the agent
// is answering in. Regression (2026-07-23): when replying inside a thread the
// typing frames dropped threadRootId, so clients rendered "CloudBot thinking…"
// above the main channel composer instead of the thread reply composer.
//
// It also drives the channel's activity spinner (#137) — same signal, for
// anyone looking at the sidebar rather than the channel. The thing that must
// never happen there is a spinner outliving the turn.
import { describe, expect, it, vi } from 'vitest';
import { ProgressReporter } from '../src/progress.js';
import type { FlowApi } from '../src/api.js';
import type { FlowSocket } from '../src/gateway.js';
import type { ProgressMode } from '../src/config.js';

function makeReporter(threadRootId: string | undefined, mode: ProgressMode = 'thinking') {
  const sendTyping = vi.fn();
  const socket = { sendTyping } as unknown as FlowSocket;
  const setChannelIndicator = vi.fn().mockResolvedValue({ state: null });
  const logs: string[] = [];
  const api = { setChannelIndicator } as unknown as FlowApi;
  const reporter = new ProgressReporter(api, socket, mode, 'chan-1', threadRootId, (m) => logs.push(m));
  return { reporter, sendTyping, setChannelIndicator, logs };
}

const states = (fn: ReturnType<typeof vi.fn>): string[] => fn.mock.calls.map((c) => c[1] as string);

/** Indicator calls are serialized through a promise chain, so the first one
 * lands a tick after start() rather than inside it. */
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('ProgressReporter typing scope', () => {
  it('carries threadRootId when answering in a thread', () => {
    const { reporter, sendTyping } = makeReporter('root-42');
    reporter.start();
    expect(sendTyping).toHaveBeenCalledWith('chan-1', 'root-42');
    void reporter.finish();
  });

  it('omits threadRootId for a top-level channel reply', () => {
    const { reporter, sendTyping } = makeReporter(undefined);
    reporter.start();
    expect(sendTyping).toHaveBeenCalledWith('chan-1', undefined);
    void reporter.finish();
  });
});

describe('ProgressReporter channel indicator', () => {
  it('spins the channel on start and stops it on finish', async () => {
    const { reporter, setChannelIndicator } = makeReporter(undefined);
    reporter.start();
    await tick();
    expect(setChannelIndicator).toHaveBeenCalledWith('chan-1', 'busy', expect.any(Number));
    await reporter.finish();
    expect(states(setChannelIndicator)).toEqual(['busy', 'none']);
  });

  it('sets it on the channel, not the thread — the sidebar row is per channel', async () => {
    const { reporter, setChannelIndicator } = makeReporter('root-42');
    reporter.start();
    await reporter.finish();
    for (const call of setChannelIndicator.mock.calls) expect(call[0]).toBe('chan-1');
  });

  it('always sets a bounded ttl, so a crashed run cannot spin forever', async () => {
    const { reporter, setChannelIndicator } = makeReporter(undefined);
    reporter.start();
    await tick();
    const ttl = setChannelIndicator.mock.calls[0]![2] as number;
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600); // the server's cap
    await reporter.finish();
  });

  it('clears exactly once even though the bridge finishes twice', async () => {
    // processMessage() awaits finish() on the success path and again in a
    // `finally` — the second call must not fire another request.
    const { reporter, setChannelIndicator } = makeReporter(undefined);
    reporter.start();
    await reporter.finish();
    await reporter.finish();
    expect(states(setChannelIndicator)).toEqual(['busy', 'none']);
  });

  it('clears after an in-flight set, never before it', async () => {
    // A turn short enough for the clear to overtake the set is exactly the one
    // where a stuck spinner would be most obviously wrong.
    const order: string[] = [];
    const { reporter, setChannelIndicator } = makeReporter(undefined);
    setChannelIndicator.mockImplementation(async (_c: string, state: string) => {
      if (state === 'busy') await new Promise((r) => setTimeout(r, 20));
      order.push(state);
      return { state: null };
    });
    reporter.start();
    await reporter.finish();
    expect(order).toEqual(['busy', 'none']);
  });

  it('still clears when setting it failed', async () => {
    // An older server 404s the endpoint; the turn must be unaffected and the
    // clear must still be attempted.
    const { reporter, setChannelIndicator, logs } = makeReporter(undefined);
    setChannelIndicator.mockRejectedValueOnce(new Error('404 not found'));
    reporter.start();
    await expect(reporter.finish()).resolves.toBeUndefined();
    expect(states(setChannelIndicator)).toEqual(['busy', 'none']);
    expect(logs.some((l) => l.includes('channel indicator'))).toBe(true);
  });

  it('leaves the channel alone in silent mode', async () => {
    const { reporter, setChannelIndicator } = makeReporter(undefined, 'silent');
    reporter.start();
    await reporter.finish();
    expect(setChannelIndicator).not.toHaveBeenCalled();
  });
});
