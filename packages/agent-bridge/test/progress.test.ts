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

function makeReporter(threadRootId: string | undefined, mode: ProgressMode = 'thinking', relayText = true) {
  const sendTyping = vi.fn();
  const socket = { sendTyping } as unknown as FlowSocket;
  const setChannelIndicator = vi.fn().mockResolvedValue({ state: null });
  const logs: string[] = [];
  let n = 0;
  const sendMessage = vi.fn().mockImplementation(() => Promise.resolve({ id: `msg-${++n}` }));
  const editMessage = vi.fn().mockResolvedValue({});
  const deleteMessage = vi.fn().mockResolvedValue(undefined);
  const api = { setChannelIndicator, sendMessage, editMessage, deleteMessage } as unknown as FlowApi;
  const reporter = new ProgressReporter(api, socket, mode, relayText, 'chan-1', threadRootId, (m) => logs.push(m));
  return { reporter, sendTyping, setChannelIndicator, sendMessage, editMessage, deleteMessage, logs };
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

// #162: the agent's interim text used to be parsed and thrown away, so a long
// turn was silence followed by a wall of text. It is relayed now — and the
// thing that must never happen is a turn that notifies once per sentence.
describe('ProgressReporter relayed text', () => {
  /** Body the narration message ended up with (no onStep in these, so every
   * edit is a narration edit). */
  const lastBody = (send: ReturnType<typeof vi.fn>, edit: ReturnType<typeof vi.fn>): string => {
    const calls = edit.mock.calls.length > 0 ? edit.mock.calls : send.mock.calls;
    return calls[calls.length - 1]![1] as string;
  };

  it('posts the first block as a message', async () => {
    const { reporter, sendMessage } = makeReporter('root-42');
    reporter.start();
    reporter.onText('Reading the parser now.');
    await reporter.finish();
    expect(sendMessage).toHaveBeenCalledWith('chan-1', 'Reading the parser now.', 'root-42');
  });

  it('grows one message by editing instead of posting per block', async () => {
    // The whole unread argument: an edit creates no notification row and cannot
    // move a channel's unread count, where a post does both.
    const { reporter, sendMessage, editMessage } = makeReporter(undefined);
    reporter.start();
    reporter.onText('First I will read the parser.');
    await tick();
    reporter.onText('Now writing the test.');
    await reporter.finish();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(lastBody(sendMessage, editMessage)).toBe('First I will read the parser.\n\nNow writing the test.');
  });

  it('coalesces blocks that arrive inside the throttle window into one write', async () => {
    const { reporter, sendMessage, editMessage } = makeReporter(undefined);
    reporter.start();
    reporter.onText('one');
    await tick();
    reporter.onText('two');
    reporter.onText('three');
    await reporter.finish();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(editMessage).toHaveBeenCalledTimes(1); // not one per block
    expect(lastBody(sendMessage, editMessage)).toBe('one\n\ntwo\n\nthree');
  });

  it('never relays the block the final reply is about to repeat', async () => {
    // Claude's terminal `result` text IS the last assistant text block.
    const { reporter, sendMessage, editMessage } = makeReporter(undefined);
    reporter.start();
    reporter.onText('Looking at runtime.ts.');
    await tick();
    reporter.onText('Done — the parser now emits text.');
    await reporter.finish('Done — the parser now emits text.');
    expect(lastBody(sendMessage, editMessage)).toBe('Looking at runtime.ts.');
  });

  it('trims a repeat that was already relayed', async () => {
    const { reporter, sendMessage, editMessage } = makeReporter(undefined);
    reporter.start();
    reporter.onText('Looking at runtime.ts.');
    await tick();
    reporter.onText('All done.');
    await tick(); // the block lands on the server before the run ends
    await reporter.finish('All done.');
    expect(lastBody(sendMessage, editMessage)).toBe('Looking at runtime.ts.');
  });

  it('deletes the narration when the reply is all there was', async () => {
    // A short turn must look exactly as it did before #162: one reply, nothing else.
    const { reporter, sendMessage, deleteMessage } = makeReporter(undefined);
    reporter.start();
    reporter.onText('Yes — 8787 is taken by the dev server.');
    await tick();
    await reporter.finish('Yes — 8787 is taken by the dev server.');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(deleteMessage).toHaveBeenCalledWith('msg-1', { hard: true });
  });

  it('seals a long message and starts a new one', async () => {
    const { reporter, sendMessage } = makeReporter(undefined);
    reporter.start();
    reporter.onText('a'.repeat(1500));
    await tick();
    reporter.onText('b'.repeat(900));
    await reporter.finish();
    // Two messages, not one 2400-character wall clients have to truncate.
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]![1]).toBe('b'.repeat(900));
  });

  it('keeps the ephemeral status row separate from the narration', async () => {
    // The tool row is decoration and still vanishes; what the agent said stays.
    const { reporter, sendMessage, deleteMessage } = makeReporter(undefined);
    reporter.start();
    reporter.onStep('Bash: pnpm test');
    await tick();
    reporter.onText('Tests are green.');
    await reporter.finish();
    const posted = sendMessage.mock.calls.map((c) => c[1] as string);
    expect(posted).toEqual(['🤖 *thinking…* — Bash: pnpm test', 'Tests are green.']);
    expect(deleteMessage).toHaveBeenCalledTimes(1);
    expect(deleteMessage).toHaveBeenCalledWith('msg-1', { hard: true }); // the status row
  });

  it('says nothing mid-turn when relayText is off', async () => {
    const { reporter, sendMessage, editMessage } = makeReporter(undefined, 'thinking', false);
    reporter.start();
    reporter.onText('narrating');
    await reporter.finish();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(editMessage).not.toHaveBeenCalled();
  });

  it('says nothing mid-turn in typing or silent mode', async () => {
    for (const mode of ['typing', 'silent'] as const) {
      const { reporter, sendMessage } = makeReporter(undefined, mode);
      reporter.start();
      reporter.onText('narrating');
      await reporter.finish();
      expect(sendMessage).not.toHaveBeenCalled();
    }
  });

  it('does not fail the turn when a relay write is rejected', async () => {
    const { reporter, sendMessage, logs } = makeReporter(undefined);
    sendMessage.mockRejectedValueOnce(new Error('503'));
    reporter.start();
    reporter.onText('narrating');
    await expect(reporter.finish()).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes('relayed text failed'))).toBe(true);
  });
});
