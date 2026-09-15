import { describe, expect, it } from 'vitest';
import { speechRecognitionConstructor, speechRecognitionErrorMessage } from './speechRecognition';

class StandardRecognizer {}
class PrefixedRecognizer {}

describe('speech recognition capability', () => {
  it('prefers the standard API and accepts the legacy prefixed API', () => {
    expect(speechRecognitionConstructor({ SpeechRecognition: StandardRecognizer, webkitSpeechRecognition: PrefixedRecognizer }))
      .toBe(StandardRecognizer);
    expect(speechRecognitionConstructor({ webkitSpeechRecognition: PrefixedRecognizer })).toBe(PrefixedRecognizer);
  });

  it('rejects non-constructors instead of exposing an untyped browser value', () => {
    expect(speechRecognitionConstructor({ SpeechRecognition: {} })).toBeNull();
    expect(speechRecognitionConstructor({})).toBeNull();
  });
});

describe('speech recognition errors', () => {
  it.each([
    ['not-allowed', 'Microphone access is blocked. Check this site\'s microphone permissions.'],
    ['audio-capture', 'No microphone is available. Check your microphone and try again.'],
    ['network', 'Speech recognition needs a connection and could not reach the service.'],
    ['no-speech', 'No speech was detected. Try again.'],
    ['unknown', 'Dictation could not start. Try again.'],
  ])('maps %s to user-facing recovery guidance', (code, message) => {
    expect(speechRecognitionErrorMessage(code)).toBe(message);
  });
});
