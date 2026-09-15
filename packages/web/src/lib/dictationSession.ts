import type { SpeechRecognitionResultListLike } from './speechRecognition';

export const MAX_MESSAGE_BODY_LENGTH = 12000;

export interface RecognitionLedger {
  finalizedIndices: Set<number>;
}

export interface RecognitionUpdate {
  finalTranscripts: string[];
  interimText: string;
}

/**
 * The browser mutates its result list in place. A result index identifies an
 * utterance; its text does not, because repeated phrases are perfectly valid.
 */
export function consumeRecognitionResults(
  ledger: RecognitionLedger,
  results: SpeechRecognitionResultListLike,
  resultIndex: number,
): RecognitionUpdate {
  const finalTranscripts: string[] = [];
  const interim: string[] = [];
  const start = Math.max(0, Math.min(resultIndex, results.length));

  // The list is the current recognizer state. Inspect all non-final entries so
  // an unchanged interim phrase remains visible when a later index changes.
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const transcript = result?.[0]?.transcript ?? '';
    if (!result) continue;
    if (result.isFinal) {
      if (index >= start && !ledger.finalizedIndices.has(index) && transcript.trim()) {
        ledger.finalizedIndices.add(index);
        finalTranscripts.push(transcript);
      }
    } else if (!ledger.finalizedIndices.has(index) && transcript.trim()) {
      interim.push(transcript.trim());
    }
  }

  return { finalTranscripts, interimText: interim.join(' ') };
}

export interface DictationDraft {
  base: string;
  start: number;
  end: number;
  dictated: string;
}

export interface DictationDraftUpdate extends DictationDraft {
  text: string;
  caret: number;
}

/** Add an utterance and rebuild the original draft around the dictated span. */
export function addDictationTranscript(draft: DictationDraft, transcript: string): DictationDraftUpdate {
  const dictated = joinDictationText(draft.dictated, transcript);
  const before = draft.base.slice(0, draft.start);
  const after = draft.base.slice(draft.end);
  const withSpeech = joinDictationText(before, dictated);
  const text = joinDictationText(withSpeech, after);
  return { ...draft, dictated, text, caret: withSpeech.length };
}

/**
 * Preserve speech-engine spacing inside each phrase and add one safe boundary
 * space only when adjacent word-like text would otherwise run together.
 */
export function joinDictationText(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  if (/\s$/u.test(left) || /^\s/u.test(right)) return left + right;

  const last = left.at(-1) ?? '';
  const first = right.at(0) ?? '';
  if (/[\]\)}>,.!?;:%]/u.test(first) || /[([\{<]/u.test(last)) return left + right;

  // Chinese, Japanese, and Korean writing normally has no spaces between
  // characters. Avoid applying English word-boundary rules to those scripts.
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(last)
    && /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(first)) {
    return left + right;
  }
  return `${left} ${right}`;
}

export function exceedsMessageLength(text: string): boolean {
  return text.length > MAX_MESSAGE_BODY_LENGTH;
}
