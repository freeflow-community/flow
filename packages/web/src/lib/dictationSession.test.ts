import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_BODY_LENGTH,
  addDictationTranscript,
  consumeRecognitionResults,
  exceedsMessageLength,
  joinDictationText,
} from './dictationSession';
import type { SpeechRecognitionResultListLike } from './speechRecognition';

function results(entries: Array<{ text: string; final: boolean }>): SpeechRecognitionResultListLike {
  return entries.map((entry) => ({ isFinal: entry.final, 0: { transcript: entry.text } })) as unknown as SpeechRecognitionResultListLike;
}

describe('consumeRecognitionResults', () => {
  it('commits each final result index once while retaining the current interim preview', () => {
    const ledger = { finalizedIndices: new Set<number>() };
    expect(consumeRecognitionResults(ledger, results([
      { text: 'meet me', final: true },
      { text: 'at noon', final: false },
    ]), 0)).toEqual({ finalTranscripts: ['meet me'], interimText: 'at noon' });

    expect(consumeRecognitionResults(ledger, results([
      { text: 'meet me', final: true },
      { text: 'at noon', final: false },
      { text: 'tomorrow', final: false },
    ]), 2)).toEqual({ finalTranscripts: [], interimText: 'at noon tomorrow' });
  });

  it('does not deduplicate identical words from different utterance indices', () => {
    const ledger = { finalizedIndices: new Set<number>() };
    const update = consumeRecognitionResults(ledger, results([
      { text: 'yes', final: true },
      { text: 'yes', final: true },
    ]), 0);
    expect(update.finalTranscripts).toEqual(['yes', 'yes']);
  });

  it('accepts a former interim result when it becomes final', () => {
    const ledger = { finalizedIndices: new Set<number>() };
    consumeRecognitionResults(ledger, results([{ text: 'hello', final: false }]), 0);
    expect(consumeRecognitionResults(ledger, results([{ text: 'hello there', final: true }]), 0))
      .toEqual({ finalTranscripts: ['hello there'], interimText: '' });
  });
});

describe('dictation draft insertion', () => {
  it('replaces the saved selection and keeps the original suffix', () => {
    const first = addDictationTranscript({ base: 'Hello team, update follows', start: 6, end: 10, dictated: '' }, 'everyone');
    expect(first.text).toBe('Hello everyone, update follows');
    expect(first.caret).toBe('Hello everyone'.length);
  });

  it('adds safe word boundaries across finalized phrases and preserves punctuation', () => {
    const first = addDictationTranscript({ base: 'Status:', start: 7, end: 7, dictated: '' }, 'ready');
    const second = addDictationTranscript(first, 'for review.');
    expect(second.text).toBe('Status: ready for review.');
    expect(joinDictationText('Hello', ', team')).toBe('Hello, team');
    expect(joinDictationText('(', 'draft')).toBe('(draft');
  });

  it('does not invent English spaces between CJK characters', () => {
    expect(joinDictationText('你好', '世界')).toBe('你好世界');
  });

  it('uses a hard existing message-body ceiling without splitting a transcript', () => {
    expect(exceedsMessageLength('x'.repeat(MAX_MESSAGE_BODY_LENGTH))).toBe(false);
    expect(exceedsMessageLength('x'.repeat(MAX_MESSAGE_BODY_LENGTH + 1))).toBe(true);
  });
});
