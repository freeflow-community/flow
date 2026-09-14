# Fix crash when answering the speech-recognition permission prompt

- `[ios]` Mark the `SFSpeechRecognizer.requestAuthorization` completion
  `@Sendable`: formed inside a `@MainActor` class it inherited main-actor
  isolation, and TCC invokes it on a background queue — the Swift 6 runtime
  isolation check crashed the app (EXC_BREAKPOINT) the moment the user
  answered the prompt. Seen live on 2.2 (546).

## Feature

- Fixed a crash when starting your first voice call with an agent: answering
  the speech-recognition permission prompt no longer quits the app.
