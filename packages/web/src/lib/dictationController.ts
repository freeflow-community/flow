import { dictationCoordinator as defaultCoordinator, type DictationCoordinator } from './dictationCoordinator';
import { consumeRecognitionResults, type RecognitionLedger } from './dictationSession';
import {
  speechRecognitionConstructor,
  speechRecognitionErrorMessage,
  type BrowserSpeechRecognition,
  type BrowserSpeechRecognitionConstructor,
} from './speechRecognition';

export type DictationState = 'unavailable' | 'idle' | 'starting' | 'listening' | 'stopping';
export type DictationEndReason = 'stopped' | 'ended' | 'cancelled' | 'replaced' | 'hidden' | 'owner-change' | 'unmount' | 'error';
export type DictationCancelReason = Exclude<DictationEndReason, 'stopped' | 'ended' | 'error'>;

export interface DictationSnapshot {
  supported: boolean;
  state: DictationState;
  interimText: string;
  error: string | null;
}

export interface DictationCallbacks {
  ownerKey: string;
  /** Capture the insertion anchor before the recognizer takes microphone focus. */
  onSessionStart(): string | null;
  /** Return an error to reject this final phrase and stop safely. */
  onFinalTranscript(transcript: string): string | null;
  onSessionEnd(reason: DictationEndReason): void;
}

type Timer = ReturnType<typeof setTimeout>;

export interface DictationEnvironment {
  recognizer(): BrowserSpeechRecognitionConstructor | null;
  language(): string;
  setTimeout(fn: () => void, ms: number): Timer;
  clearTimeout(timer: Timer): void;
  coordinator: DictationCoordinator;
}

export const START_TIMEOUT_MS = 30_000;
export const FINISH_TIMEOUT_MS = 5_000;
export const SESSION_TIMEOUT_MS = 120_000;

interface Session {
  recognizer: BrowserSpeechRecognition;
  ledger: RecognitionLedger;
  stopping: boolean;
  timers: Timer[];
}

const browserEnvironment = (): DictationEnvironment => ({
  recognizer: () => speechRecognitionConstructor(),
  language: () => (typeof navigator !== 'undefined' && navigator.language) || 'en-US',
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer),
  coordinator: defaultCoordinator,
});

/**
 * Browser-managed dictation lifecycle, free of React so the ordering rules can
 * be tested directly. The controller owns recognizer cleanup and stale
 * callbacks; the composer owns its contenteditable transaction.
 *
 * Every exit path detaches the recognizer's handlers and drops the session
 * BEFORE calling `abort()`/`stop()` failures through: implementations may fire
 * `error`, `end`, or even a final `result` synchronously from inside `abort()`.
 */
export class DictationController {
  private session: Session | null = null;
  private readonly owner = Symbol('dictation-composer');
  private readonly listeners = new Set<() => void>();
  private snapshot: DictationSnapshot;

  constructor(
    private readonly callbacks: () => DictationCallbacks,
    private readonly env: DictationEnvironment = browserEnvironment(),
  ) {
    const supported = env.recognizer() !== null;
    this.snapshot = { supported, state: supported ? 'idle' : 'unavailable', interimText: '', error: null };
  }

  getSnapshot = (): DictationSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get isActive(): boolean {
    return this.session !== null;
  }

  start = (): void => {
    const Constructor = this.env.recognizer();
    if (!Constructor) {
      this.update({ supported: false, state: 'unavailable', error: 'Dictation is not available in this browser.' });
      return;
    }
    if (this.session) return;
    const startError = this.callbacks().onSessionStart();
    if (startError) {
      this.update({ supported: true, error: startError });
      return;
    }

    let recognizer: BrowserSpeechRecognition;
    try {
      recognizer = new Constructor();
      recognizer.lang = this.env.language();
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.maxAlternatives = 1;
    } catch {
      // The composer already opened its transaction in onSessionStart; close it.
      this.update({ supported: true, state: 'idle', error: 'Dictation could not start. Try again.' });
      this.callbacks().onSessionEnd('error');
      return;
    }

    const session: Session = { recognizer, ledger: { finalizedIndices: new Set() }, stopping: false, timers: [] };
    this.session = session;
    this.env.coordinator.acquire(this.owner, this.callbacks().ownerKey, () => this.cancel('replaced'));
    this.update({ supported: true, state: 'starting', interimText: '', error: null });

    const current = () => this.session === session;
    recognizer.onstart = () => {
      if (!current()) return;
      this.update({ state: session.stopping ? 'stopping' : 'listening' });
    };
    recognizer.onresult = (event) => {
      if (!current()) return;
      const result = consumeRecognitionResults(session.ledger, event.results, event.resultIndex);
      for (const transcript of result.finalTranscripts) {
        const rejection = this.callbacks().onFinalTranscript(transcript);
        if (rejection) {
          this.finish(session, 'error', rejection, 'abort');
          return;
        }
        // A callback may have cancelled this session (e.g. owner change).
        if (!current()) return;
      }
      this.update({ interimText: result.interimText });
    };
    recognizer.onerror = (event) => {
      if (!current()) return;
      this.finish(session, 'error', speechRecognitionErrorMessage(event.error), 'abort');
    };
    recognizer.onend = () => {
      if (!current()) return;
      this.finish(session, session.stopping ? 'stopped' : 'ended');
    };
    session.timers.push(this.env.setTimeout(() => {
      if (current() && this.snapshot.state === 'starting') {
        this.finish(session, 'error', 'Dictation took too long to start. Try again.', 'abort');
      }
    }, START_TIMEOUT_MS));
    session.timers.push(this.env.setTimeout(() => {
      if (current()) this.finish(session, 'error', 'Dictation ended after two minutes. You can start another session.', 'abort');
    }, SESSION_TIMEOUT_MS));

    try {
      recognizer.start();
    } catch {
      if (current()) this.finish(session, 'error', 'Dictation could not start. Try again.', 'abort');
    }
  };

  stop = (): void => {
    const session = this.session;
    if (!session || session.stopping) return;
    session.stopping = true;
    this.update({ state: 'stopping' });
    session.timers.push(this.env.setTimeout(() => {
      if (this.session === session) this.finish(session, 'error', 'Dictation took too long to finish. Try again.', 'abort');
    }, FINISH_TIMEOUT_MS));
    try {
      // May synchronously deliver the last result and `end`.
      session.recognizer.stop();
    } catch {
      if (this.session === session) this.finish(session, 'error', 'Dictation could not finish. Try again.', 'abort');
    }
  };

  cancel = (reason: DictationCancelReason = 'cancelled'): void => {
    const session = this.session;
    if (session) this.finish(session, reason, undefined, 'abort');
  };

  clearError = (): void => {
    if (this.snapshot.error) this.update({ error: null });
  };

  /**
   * The single exit path. Order matters: detach handlers and release the
   * session first, then abort, then report — so anything the recognizer emits
   * while aborting reaches a dead handler instead of the draft.
   */
  private finish(session: Session, reason: DictationEndReason, message?: string, recognizerAction?: 'abort'): void {
    if (this.session !== session) return;
    for (const timer of session.timers) this.env.clearTimeout(timer);
    session.timers = [];
    const { recognizer } = session;
    recognizer.onstart = null;
    recognizer.onresult = null;
    recognizer.onerror = null;
    recognizer.onend = null;
    this.session = null;
    this.env.coordinator.release(this.owner);
    if (recognizerAction === 'abort') {
      try { recognizer.abort(); } catch { /* already stopped */ }
    }
    const supported = this.env.recognizer() !== null;
    this.update({
      supported,
      state: supported ? 'idle' : 'unavailable',
      interimText: '',
      ...(message ? { error: message } : {}),
    });
    this.callbacks().onSessionEnd(reason);
  }

  private update(patch: Partial<DictationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/** Page lifecycle wiring: pagehide always cancels, a hidden tab cancels, Escape cancels. */
export function bindDictationPageEvents(
  controller: Pick<DictationController, 'cancel' | 'isActive'>,
  win: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> = document,
): () => void {
  // pagehide fires for bfcache navigations while visibilityState can still
  // read "visible", so it cancels unconditionally.
  const onPageHide = () => controller.cancel('hidden');
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') controller.cancel('hidden');
  };
  const onKeyDown = (event: Event) => {
    if ((event as KeyboardEvent).key !== 'Escape' || !controller.isActive) return;
    event.preventDefault();
    controller.cancel();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('keydown', onKeyDown);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pagehide', onPageHide);
    win.removeEventListener('keydown', onKeyDown);
  };
}
