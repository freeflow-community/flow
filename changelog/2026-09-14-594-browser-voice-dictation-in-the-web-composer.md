# Browser voice dictation in the web composer (#594)

- `[web]` Mic button beside Send uses the browser's SpeechRecognition. Finalized
  phrases are inserted at the saved caret, and the draft is locked while listening. Ported from #593.
- `[web]` Every capture exit detaches handlers before `abort()`. Pagehide always
  cancels, and focus returns to the editor after Stop.
- `[desktop]` The mic button is hidden in the Electron app: its Chromium has no
  speech service behind the API, and system dictation covers its text fields.

## Feature

- **Dictate a message in your browser.** Click the microphone beside Send, speak,
  then review or edit the text before sending. Your browser does the
  recognition and may use its own speech service; Flow stores no audio.
