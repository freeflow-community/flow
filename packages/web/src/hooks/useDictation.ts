import { useCallback, useEffect, useRef, useState } from 'react';
import { dictationCoordinator } from '../lib/dictationCoordinator';
import { consumeRecognitionResults, type RecognitionLedger } from '../lib/dictationSession';
import {
  speechRecognitionConstructor,
  speechRecognitionErrorMessage,
  type BrowserSpeechRecognition,
} from '../lib/speechRecognition';

export type DictationState = 'unavailable' | 'idle' | 'starting' | 'listening' | 'stopping';
export type DictationEndReason = 'stopped' | 'ended' | 'cancelled' | 'replaced' | 'hidden' | 'owner-change' | 'unmount' | 'error';

interface Session {
  recognizer: BrowserSpeechRecognition;
  token: number;
  ledger: RecognitionLedger;
  stopping: boolean;
  startTimer: ReturnType<typeof setTimeout> | null;
  finishTimer: ReturnType<typeof setTimeout> | null;
  sessionTimer: ReturnType<typeof setTimeout> | null;
}

export interface UseDictationOptions {
  ownerKey: string;
  /** Capture the insertion anchor before the recognizer takes microphone focus. */
  onSessionStart(): string | null;
  /** Return an error to reject this final phrase and stop safely. */
  onFinalTranscript(transcript: string): string | null;
  onSessionEnd(reason: DictationEndReason): void;
}

export interface DictationControls {
  supported: boolean;
  state: DictationState;
  isActive: boolean;
  interimText: string;
  error: string | null;
  start(): void;
  stop(): void;
  cancel(reason?: Exclude<DictationEndReason, 'stopped' | 'ended' | 'error'>): void;
  clearError(): void;
}

const START_TIMEOUT_MS = 30_000;
const FINISH_TIMEOUT_MS = 5_000;
const SESSION_TIMEOUT_MS = 120_000;

/**
 * Browser-managed dictation lifecycle. The hook owns recognizer cleanup and
 * stale callbacks; the composer owns its contenteditable transaction.
 */
export function useDictation(options: UseDictationOptions): DictationControls {
  const callbacks = useRef(options);
  callbacks.current = options;
  const owner = useRef(Symbol('dictation-composer'));
  const sessionRef = useRef<Session | null>(null);
  const tokenRef = useRef(0);
  const [supported, setSupported] = useState(() => speechRecognitionConstructor() !== null);
  const [state, setState] = useState<DictationState>(() => speechRecognitionConstructor() ? 'idle' : 'unavailable');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isCurrent = (session: Session) => sessionRef.current === session && tokenRef.current === session.token;

  const clearTimers = (session: Session) => {
    if (session.startTimer) clearTimeout(session.startTimer);
    if (session.finishTimer) clearTimeout(session.finishTimer);
    if (session.sessionTimer) clearTimeout(session.sessionTimer);
    session.startTimer = null;
    session.finishTimer = null;
    session.sessionTimer = null;
  };

  const settle = useCallback((session: Session, reason: DictationEndReason, message?: string) => {
    if (sessionRef.current !== session) return;
    clearTimers(session);
    session.recognizer.onstart = null;
    session.recognizer.onresult = null;
    session.recognizer.onerror = null;
    session.recognizer.onend = null;
    sessionRef.current = null;
    dictationCoordinator.release(owner.current);
    setInterimText('');
    setState(speechRecognitionConstructor() ? 'idle' : 'unavailable');
    if (message) setError(message);
    callbacks.current.onSessionEnd(reason);
  // `clearTimers` and all refs are stable for the lifetime of this hook.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = useCallback((reason: Exclude<DictationEndReason, 'stopped' | 'ended' | 'error'> = 'cancelled') => {
    const session = sessionRef.current;
    if (!session) return;
    // Invalidate before aborting: implementations are allowed to emit a final
    // result while abort is in progress.
    tokenRef.current += 1;
    clearTimers(session);
    session.recognizer.onstart = null;
    session.recognizer.onresult = null;
    session.recognizer.onerror = null;
    session.recognizer.onend = null;
    sessionRef.current = null;
    dictationCoordinator.release(owner.current);
    try { session.recognizer.abort(); } catch { /* already stopped */ }
    setInterimText('');
    setState(speechRecognitionConstructor() ? 'idle' : 'unavailable');
    callbacks.current.onSessionEnd(reason);
  // `clearTimers` and all refs are stable for the lifetime of this hook.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(() => {
    const Constructor = speechRecognitionConstructor();
    setSupported(Constructor !== null);
    if (!Constructor) {
      setState('unavailable');
      setError('Dictation is not available in this browser.');
      return;
    }
    if (sessionRef.current) return;
    const startError = callbacks.current.onSessionStart();
    if (startError) {
      setError(startError);
      return;
    }

    let recognizer: BrowserSpeechRecognition;
    try {
      recognizer = new Constructor();
      recognizer.lang = navigator.language || 'en-US';
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.maxAlternatives = 1;
    } catch {
      setError('Dictation could not start. Try again.');
      return;
    }

    const session: Session = {
      recognizer,
      token: tokenRef.current + 1,
      ledger: { finalizedIndices: new Set() },
      stopping: false,
      startTimer: null,
      finishTimer: null,
      sessionTimer: null,
    };
    tokenRef.current = session.token;
    sessionRef.current = session;
    dictationCoordinator.acquire(owner.current, callbacks.current.ownerKey, () => cancel('replaced'));
    setError(null);
    setInterimText('');
    setState('starting');

    recognizer.onstart = () => {
      if (!isCurrent(session)) return;
      if (session.startTimer) clearTimeout(session.startTimer);
      session.startTimer = null;
      setState(session.stopping ? 'stopping' : 'listening');
    };
    recognizer.onresult = (event) => {
      if (!isCurrent(session)) return;
      const update = consumeRecognitionResults(session.ledger, event.results, event.resultIndex);
      for (const transcript of update.finalTranscripts) {
        const rejection = callbacks.current.onFinalTranscript(transcript);
        if (rejection) {
          try { session.recognizer.abort(); } catch { /* already stopped */ }
          settle(session, 'error', rejection);
          return;
        }
      }
      setInterimText(update.interimText);
    };
    recognizer.onerror = (event) => {
      if (!isCurrent(session)) return;
      settle(session, 'error', speechRecognitionErrorMessage(event.error));
    };
    recognizer.onend = () => {
      if (!isCurrent(session)) return;
      settle(session, session.stopping ? 'stopped' : 'ended');
    };
    session.startTimer = setTimeout(() => {
      if (!isCurrent(session)) return;
      try { session.recognizer.abort(); } catch { /* already stopped */ }
      settle(session, 'error', 'Dictation took too long to start. Try again.');
    }, START_TIMEOUT_MS);
    session.sessionTimer = setTimeout(() => {
      if (!isCurrent(session)) return;
      try { session.recognizer.abort(); } catch { /* already stopped */ }
      settle(session, 'error', 'Dictation ended after two minutes. You can start another session.');
    }, SESSION_TIMEOUT_MS);

    try {
      recognizer.start();
    } catch {
      settle(session, 'error', 'Dictation could not start. Try again.');
    }
  }, [cancel, settle]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.stopping) return;
    session.stopping = true;
    setState('stopping');
    session.finishTimer = setTimeout(() => {
      if (!isCurrent(session)) return;
      try { session.recognizer.abort(); } catch { /* already stopped */ }
      settle(session, 'error', 'Dictation took too long to finish. Try again.');
    }, FINISH_TIMEOUT_MS);
    try {
      session.recognizer.stop();
    } catch {
      settle(session, 'error', 'Dictation could not finish. Try again.');
    }
  }, [settle]);

  useEffect(() => {
    const cancelWhenHidden = () => {
      if (document.visibilityState === 'hidden') cancel('hidden');
    };
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !sessionRef.current) return;
      event.preventDefault();
      cancel();
    };
    document.addEventListener('visibilitychange', cancelWhenHidden);
    window.addEventListener('pagehide', cancelWhenHidden);
    window.addEventListener('keydown', cancelOnEscape);
    return () => {
      document.removeEventListener('visibilitychange', cancelWhenHidden);
      window.removeEventListener('pagehide', cancelWhenHidden);
      window.removeEventListener('keydown', cancelOnEscape);
      cancel('unmount');
    };
  }, [cancel, options.ownerKey]);

  return {
    supported,
    state,
    isActive: state === 'starting' || state === 'listening' || state === 'stopping',
    interimText,
    error,
    start,
    stop,
    cancel,
    clearError: () => setError(null),
  };
}
