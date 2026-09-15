# Add browser voice dictation to the message composer

## Summary

Flow's web composer previously required typed or pasted text. This change adds a
microphone control immediately before Send in channel, DM, and thread composers.
Click it to start browser-managed dictation; click it again to stop. Finalized
speech is inserted into the draft at the saved cursor or selection, then the
user reviews, edits, and explicitly sends the message.

The web client uses the browser's built-in SpeechRecognition API. It adds no
paid SDK, API key, Flow transcription endpoint, audio recording, or automatic
send behavior. While active, Flow says that the browser may send audio to its
speech service rather than claiming the feature is always on-device.

## How it works

- Uses the standard `SpeechRecognition` constructor or the legacy
  `webkitSpeechRecognition` constructor when available.
- Requests continuous results using the browser's language preference.
- Displays revisable words separately as “Hearing:” text; they never become
  draft text or an outgoing payload.
- Commits every finalized result index once. Repeated spoken phrases are kept
  because result indices, rather than transcript strings, identify utterances.
- Preserves the original prefix and suffix around a selected range, places the
  cursor after dictated text, and applies safe word-boundary spacing.
- Limits the assembled draft to the existing 12,000-character message maximum.
- Locks draft editing, attachment/emoji/mention actions, and Send while the
  microphone is starting, listening, or stopping.
- Esc cancels, Stop attempts a final result, navigation/composer changes abort,
  and one app-document coordinator prevents a channel and a thread composer
  from recording at the same time.
- Offers “Undo dictation” after a completed session while the draft remains
  unchanged.

## Screenshots

Local browser visual QA captured both states in this Codex task:

1. Idle channel composer: a compact outline microphone is immediately left of
   the purple Send control.
2. Active dictation: the microphone changes to Stop, text editing and Send are
   disabled, and the composer shows “Starting dictation…” plus the
   browser-processing disclosure.

The screenshots were captured against the built web UI using a temporary,
local-only API stub because Docker is not installed on this machine. No real
account, message, audio, or microphone permission was used.

## Validation

| Check | Result |
| --- | --- |
| Web TypeScript check | Passed: `tsc -p packages/web/tsconfig.json --noEmit` |
| Web unit/component suite | Passed: 16 files, 96 tests |
| Production Vite bundle | Passed: 139 modules transformed |
| Local visual QA | Passed: placement, enabled idle control, active Stop state, locked toolbar and Send, status disclosure |
| Real microphone transcription | Not run: no microphone permission was requested or granted during local QA |

The normal `pnpm --filter @flow/web build` command could not begin in this
workspace because pnpm requires approval for existing ignored native build
scripts (`argon2` and `esbuild`). Direct use of the already-installed TypeScript
compiler and Vite completed successfully.

## Added coverage

- Browser constructor detection and normalized permission/device/network errors.
- Interim revisions, finalized result deduplication, repeated identical phrases,
  and former interim results becoming final.
- Selection replacement, punctuation and CJK spacing, draft length boundaries.
- Single-owner coordination between composers and stale-owner cleanup.

## Client impact

- [x] web client
- [ ] macOS client
- [ ] iOS client
- [ ] agent bridge

## Follow-up scope

macOS and iOS use separate SwiftUI composers and need native Speech framework
implementations. A strictly on-device web option also needs browser language-pack
capability and installation work; this PR intentionally ships browser-managed
recognition only.

## Reviewer checklist

- Confirm the Mic → Stop → review → Send interaction matches the composer
  conventions.
- Confirm the browser-processing disclosure accurately describes the privacy
  boundary.
- Check the unsupported-browser and microphone-error copy on target browsers.
- Run a real-microphone pass on supported Chrome/Edge/Safari environments before
  release.

No GitHub pull request was created, pushed, or merged. This file is the local
PR description for branch `codex/voice-dictation`.
