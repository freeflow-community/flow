import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDictationCoordinator } from './dictationCoordinator';
import {
  DictationController,
  FINISH_TIMEOUT_MS,
  SESSION_TIMEOUT_MS,
  START_TIMEOUT_MS,
  bindDictationPageEvents,
  type DictationCallbacks,
  type DictationEnvironment,
} from './dictationController';
import type {
  BrowserSpeechRecognition,
  SpeechRecognitionErrorEventLike,
  SpeechRecognitionResultEventLike,
} from './speechRecognition';

class FakeRecognizer implements BrowserSpeechRecognition {
  static instances: FakeRecognizer[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  /** Handlers still attached at the moment abort() was called. */
  attachedAtAbort: boolean[] = [];
  onAbort: ((self: FakeRecognizer) => void) | null = null;
  onStop: ((self: FakeRecognizer) => void) | null = null;
  // Real listeners that some engines keep calling even after detach.
  saved: Pick<FakeRecognizer, 'onresult' | 'onerror' | 'onend'> | null = null;

  constructor() {
    FakeRecognizer.instances.push(this);
  }
  start() {
    this.started += 1;
    this.saved = { onresult: this.onresult, onerror: this.onerror, onend: this.onend };
  }
  stop() {
    this.onStop?.(this);
  }
  abort() {
    this.attachedAtAbort.push(this.onresult !== null || this.onerror !== null || this.onend !== null);
    this.onAbort?.(this);
  }
  /** Emit through the live handlers (what the browser does). */
  final(text: string, index = 0) {
    this.onresult?.(resultEvent([{ text, final: true }], index));
  }
}

function resultEvent(entries: Array<{ text: string; final: boolean }>, resultIndex = 0): SpeechRecognitionResultEventLike {
  const results = entries.map((e) => ({ isFinal: e.final, 0: { transcript: e.text } }));
  return { resultIndex, results: results as unknown as SpeechRecognitionResultEventLike['results'] };
}

/** An abort() that synchronously emits a final result, an error, and end. */
function noisyAbort(r: FakeRecognizer) {
  r.onresult?.(resultEvent([{ text: 'late words', final: true }], 0));
  r.onerror?.({ error: 'aborted' });
  r.onend?.();
}

function setup(over: Partial<DictationCallbacks> = {}, env: Partial<DictationEnvironment> = {}) {
  const calls = {
    transcripts: [] as string[],
    ends: [] as string[],
  };
  const callbacks: DictationCallbacks = {
    ownerKey: 'ws|chan||draft',
    onSessionStart: () => null,
    onFinalTranscript: (t) => {
      calls.transcripts.push(t);
      return null;
    },
    onSessionEnd: (reason) => {
      calls.ends.push(reason);
    },
    ...over,
  };
  const coordinator = env.coordinator ?? createDictationCoordinator();
  const controller = new DictationController(() => callbacks, {
    recognizer: () => FakeRecognizer,
    language: () => 'en-US',
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
    coordinator,
    ...env,
  });
  return { controller, calls, callbacks, coordinator };
}

const last = () => FakeRecognizer.instances[FakeRecognizer.instances.length - 1]!;

beforeEach(() => {
  FakeRecognizer.instances = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('DictationController lifecycle', () => {
  it('moves starting → listening → stopping → idle and delivers final text once', () => {
    const { controller, calls } = setup();
    controller.start();
    const r = last();
    expect(r.continuous && r.interimResults).toBe(true);
    expect(controller.getSnapshot().state).toBe('starting');
    r.onstart?.();
    expect(controller.getSnapshot().state).toBe('listening');
    r.onresult?.(resultEvent([{ text: 'hello', final: true }, { text: 'wor', final: false }]));
    expect(controller.getSnapshot().interimText).toBe('wor');
    r.onStop = (self) => {
      self.onresult?.(resultEvent([{ text: 'hello', final: true }, { text: 'world', final: true }], 1));
      self.onend?.();
    };
    controller.stop();
    expect(calls.transcripts).toEqual(['hello', 'world']);
    expect(calls.ends).toEqual(['stopped']);
    expect(controller.getSnapshot()).toMatchObject({ state: 'idle', interimText: '', error: null });
  });

  it('ignores results, errors, and end fired synchronously from inside abort() on cancel', () => {
    const { controller, calls } = setup();
    controller.start();
    const r = last();
    r.onstart?.();
    r.onAbort = noisyAbort;
    controller.cancel();
    expect(r.attachedAtAbort).toEqual([false]);
    expect(calls.transcripts).toEqual([]);
    expect(calls.ends).toEqual(['cancelled']);
    expect(controller.getSnapshot().error).toBeNull();
  });

  it('start timeout detaches handlers before aborting and reports the timeout, not "interrupted"', () => {
    const { controller, calls } = setup();
    controller.start();
    const r = last();
    r.onAbort = noisyAbort;
    vi.advanceTimersByTime(START_TIMEOUT_MS);
    expect(r.attachedAtAbort).toEqual([false]);
    expect(calls.transcripts).toEqual([]);
    expect(calls.ends).toEqual(['error']);
    expect(controller.getSnapshot().error).toBe('Dictation took too long to start. Try again.');
  });

  it('session timeout detaches handlers before aborting', () => {
    const { controller, calls } = setup();
    controller.start();
    const r = last();
    r.onstart?.();
    r.onAbort = noisyAbort;
    vi.advanceTimersByTime(SESSION_TIMEOUT_MS);
    expect(r.attachedAtAbort).toEqual([false]);
    expect(calls.transcripts).toEqual([]);
    expect(calls.ends).toEqual(['error']);
    expect(controller.getSnapshot().error).toMatch(/two minutes/);
  });

  it('stop timeout aborts a recognizer that never ends, after detaching', () => {
    const { controller, calls } = setup();
    controller.start();
    const r = last();
    r.onstart?.();
    controller.stop();
    expect(controller.getSnapshot().state).toBe('stopping');
    r.onAbort = noisyAbort;
    vi.advanceTimersByTime(FINISH_TIMEOUT_MS - 1);
    expect(calls.ends).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(r.attachedAtAbort).toEqual([false]);
    expect(calls.transcripts).toEqual([]);
    expect(calls.ends).toEqual(['error']);
    expect(controller.getSnapshot()).toMatchObject({ state: 'idle', error: 'Dictation took too long to finish. Try again.' });
  });

  it('a rejected final phrase stops the session before later phrases or abort echoes land', () => {
    const { controller, calls } = setup({
      onFinalTranscript: (t) => {
        calls.transcripts.push(t);
        return 'Dictation reached the 12,000-character message limit.';
      },
    });
    controller.start();
    const r = last();
    r.onstart?.();
    r.onAbort = noisyAbort;
    r.onresult?.(resultEvent([{ text: 'one', final: true }, { text: 'two', final: true }]));
    expect(r.attachedAtAbort).toEqual([false]);
    expect(calls.transcripts).toEqual(['one']);
    expect(calls.ends).toEqual(['error']);
    expect(controller.getSnapshot().error).toMatch(/12,000/);
  });

  it('a recognizer error detaches before aborting and maps the error code', () => {
    const { controller, calls } = setup();
    controller.start();
    const r = last();
    r.onAbort = noisyAbort;
    r.onerror?.({ error: 'not-allowed' });
    expect(r.attachedAtAbort).toEqual([false]);
    expect(calls.ends).toEqual(['error']);
    expect(controller.getSnapshot().error).toMatch(/Microphone access is blocked/);
  });

  it('closes the composer transaction when the constructor throws', () => {
    const opened: string[] = [];
    const { controller, calls } = setup(
      { onSessionStart: () => { opened.push('open'); return null; } },
      { recognizer: () => class { constructor() { throw new Error('nope'); } } as never },
    );
    controller.start();
    expect(opened).toEqual(['open']);
    expect(calls.ends).toEqual(['error']);
    expect(controller.getSnapshot()).toMatchObject({ state: 'idle', error: 'Dictation could not start. Try again.' });
    expect(controller.isActive).toBe(false);
  });

  it('closes the session when recognizer.start() throws', () => {
    const { controller, calls, coordinator } = setup();
    const original = FakeRecognizer.prototype.start;
    FakeRecognizer.prototype.start = () => { throw new Error('busy'); };
    try {
      controller.start();
    } finally {
      FakeRecognizer.prototype.start = original;
    }
    expect(calls.ends).toEqual(['error']);
    expect(coordinator.activeOwnerKey()).toBeNull();
  });

  it('does not open a session when onSessionStart refuses', () => {
    const { controller, calls } = setup({ onSessionStart: () => 'no box' });
    controller.start();
    expect(FakeRecognizer.instances).toHaveLength(0);
    expect(calls.ends).toEqual([]);
    expect(controller.getSnapshot().error).toBe('no box');
  });

  it('owner change and unmount cancels drop late events from the old recognizer', () => {
    for (const reason of ['owner-change', 'unmount'] as const) {
      const { controller, calls } = setup();
      controller.start();
      const r = last();
      r.onstart?.();
      const live = r.saved!;
      controller.cancel(reason);
      // An engine that captured the old listeners still calls them.
      live.onresult?.(resultEvent([{ text: 'stale', final: true }]));
      live.onerror?.({ error: 'network' });
      live.onend?.();
      expect(calls.transcripts).toEqual([]);
      expect(calls.ends).toEqual([reason]);
      expect(controller.getSnapshot().error).toBeNull();
    }
  });

  it('a second composer taking the microphone replaces the first', () => {
    const coordinator = createDictationCoordinator();
    const a = setup({ ownerKey: 'a' }, { coordinator });
    const b = setup({ ownerKey: 'b' }, { coordinator });
    a.controller.start();
    b.controller.start();
    expect(a.calls.ends).toEqual(['replaced']);
    expect(a.controller.isActive).toBe(false);
    expect(coordinator.activeOwnerKey()).toBe('b');
  });
});

describe('bindDictationPageEvents', () => {
  function target() {
    const listeners = new Map<string, Set<(e: Event) => void>>();
    return {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (type: string, fn: (e: Event) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: (e: Event) => void) => listeners.get(type)?.delete(fn),
      fire: (type: string, event: Partial<KeyboardEvent> = {}) => {
        const e = { preventDefault: vi.fn(), ...event } as unknown as Event;
        for (const fn of listeners.get(type) ?? []) fn(e);
        return e;
      },
      count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    };
  }

  it('cancels on pagehide even while the document still reports visible', () => {
    const win = target();
    const doc = target();
    const controller = { isActive: true, cancel: vi.fn() };
    bindDictationPageEvents(controller, win as never, doc as never);
    win.fire('pagehide');
    expect(controller.cancel).toHaveBeenCalledWith('hidden');
  });

  it('cancels on visibilitychange only when hidden', () => {
    const win = target();
    const doc = target();
    const controller = { isActive: true, cancel: vi.fn() };
    bindDictationPageEvents(controller, win as never, doc as never);
    doc.fire('visibilitychange');
    expect(controller.cancel).not.toHaveBeenCalled();
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    expect(controller.cancel).toHaveBeenCalledWith('hidden');
  });

  it('Escape cancels only an active session, and unbinding removes every listener', () => {
    const win = target();
    const doc = target();
    const controller = { isActive: false, cancel: vi.fn() };
    const unbind = bindDictationPageEvents(controller, win as never, doc as never);
    win.fire('keydown', { key: 'Escape' });
    expect(controller.cancel).not.toHaveBeenCalled();
    controller.isActive = true;
    const e = win.fire('keydown', { key: 'Escape' });
    expect(controller.cancel).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
    unbind();
    expect(win.count() + doc.count()).toBe(0);
  });
});
