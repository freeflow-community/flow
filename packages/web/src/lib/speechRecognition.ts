/**
 * Minimal browser SpeechRecognition surface. TypeScript's DOM lib intentionally
 * does not expose this experimental API in every supported compiler version, so
 * keep the non-standard types contained here rather than spreading `any` through
 * the composer.
 */
export interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike | undefined;
}

export interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike {
  error?: string;
}

export interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface BrowserSpeechRecognitionConstructor {
  new (): BrowserSpeechRecognition;
}

type SpeechRecognitionHost = {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
};

/** Return the standard or legacy-prefixed constructor when the browser offers one. */
export function speechRecognitionConstructor(host: unknown = globalThis): BrowserSpeechRecognitionConstructor | null {
  const candidate = (host as SpeechRecognitionHost).SpeechRecognition
    ?? (host as SpeechRecognitionHost).webkitSpeechRecognition;
  return typeof candidate === 'function' ? candidate as BrowserSpeechRecognitionConstructor : null;
}

export function speechRecognitionErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return "Microphone access is blocked. Check this site's microphone permissions.";
    case 'audio-capture':
      return 'No microphone is available. Check your microphone and try again.';
    case 'network':
      return 'Speech recognition needs a connection and could not reach the service.';
    case 'language-not-supported':
      return 'Dictation is not available for this browser language.';
    case 'no-speech':
      return 'No speech was detected. Try again.';
    case 'aborted':
      return 'Dictation was interrupted. Try again.';
    default:
      return 'Dictation could not start. Try again.';
  }
}
