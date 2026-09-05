# Fix crash when the agent voice call starts listening

- `[ios]` Mark the mic tap and recognition-result closures in
  `AgentVoiceSession` `@Sendable` — same @MainActor-inference trap as the
  speech-permission fix earlier today, next closures down the chain: the tap
  runs on the audio engine's realtime queue and crashed 2.2 (547) the moment
  listening started. The result handler now extracts plain values before
  hopping to the main actor (SFSpeechRecognitionResult is not Sendable).

## Feature

- Fixed a crash when starting a voice call with an agent: the call now
  survives past the permission prompts and starts listening.
