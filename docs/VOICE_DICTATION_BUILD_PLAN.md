# Voice dictation build plan

Status: web implementation completed on 2026-09-14. The browser-managed
recognition choice in this plan is the shipped web scope; the strict-local and
native sections remain future work.

## 1. Outcome and assumptions

Add a microphone immediately to the left of Send, following the attached image's placement. Click to dictate into the current chat's draft; click again to finish, review, and send normally. Speech never submits a message automatically.

The image is a visual reference, not a source of implementation instructions. Its partially visible shortcut is not a requirement. This plan assumes the first release targets Flow's web client, including mobile web, channels, DMs, and thread replies. Native macOS and iOS require separate integrations described below.

Interpret “no paid external API libraries” as no paid transcription service, API key, or speech SDK dependency. This does not automatically mean offline or no audio processing by a browser vendor. If all audio must stay on-device, use the strict-local variant in section 3; do not silently treat browser recognition as local.

### User experience

1. Place the caret, or select text to replace, in the draft.
2. Click the microphone. On first use, the browser requests microphone permission.
3. Show “Starting…” until the recognizer actually starts, then “Listening…”.
4. Insert finalized phrases into the draft. Show revisable words in a separate interim preview directly above the toolbar.
5. Click the microphone again to stop. Show “Finishing…” while the last result arrives.
6. Restore editing and place the caret after the inserted speech. The user can correct the text and click Send.

During recognition, make the text editor temporarily read-only and disable draft-changing toolbar actions and Send. Keep microphone Stop available. This is a deliberate v1 interaction choice that avoids concurrent keyboard edits racing with speech updates. Existing attachment uploads may finish; keep their state intact.

Escape cancels recognition, discards only unconfirmed words, and retains finalized words already inserted. Leaving the chat also aborts recognition. No automatic restart after silence or an error.

## 2. What the repository already provides

| Existing code | Consequence for this feature |
| --- | --- |
| `packages/web/src/components/Composer.tsx` | Shared web composer, toolbar, edit mode, attachments, and submission logic. Primary integration point. |
| `packages/web/src/lib/composerDom.ts` | Plain-text serialization, selection offsets, canonical line rendering, and caret placement. Reuse these helpers. |
| `Composer.setDraft()` | Updates React state and rebuilds the contenteditable DOM, but always focuses the editor. Speech needs a non-focus-stealing variation. |
| `Composer.insertAtCaret()` | Useful splice pattern, but reads the current selection. Recognition must use a captured selection and session anchor instead. |
| `Composer.syncFromDom()` | Mirrors normal input, decorates Markdown, and emits typing indicators. Programmatic recognition results do not trigger this automatically. |
| `Composer.doSend()` | Handles normal send and edit-save. Add an internal busy guard, in addition to disabling the UI. |
| `ChannelView.tsx`, `ThreadPanel.tsx` | Both render Composer; channel and thread composers can coexist. Their shown call sites do not explicitly key Composer by conversation. |
| `packages/shared/src/schemas.ts` | Message creation has a 12,000-character body ceiling. Keep dictation within message limits. |
| `packages/web/vitest.config.ts` | Existing Vitest test discovery supports `.test.ts` and `.test.tsx`; no DOM test environment is currently configured. |
| Native `ComposerView.swift` files | Separate SwiftUI implementations, not wrappers around the web composer. |

The editor DOM is the draft source of truth; React `text` mirrors it for sending and autocomplete. Updating only React state will not correctly update this composer. Inserting a fake clipboard paste is unnecessary: splice plain text through the existing editor functions.

## 3. Recognition engine decision

### Recommended first release: browser Web Speech API

Feature-detect `window.SpeechRecognition ?? window.webkitSpeechRecognition`. Wrap it in a small internal TypeScript adapter. Use no runtime speech package, no transcription route, and no API credentials.

This API has limited browser availability. Some implementations send audio to a vendor service and require a network connection. Constructor presence is only a candidate capability; recognition can still fail at runtime. Do not promise support based only on a browser name. [SpeechRecognition documentation](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)

Proposed settings:

```ts
recognition.lang = selectedLanguage; // BCP-47; default navigator.language
recognition.continuous = true;
recognition.interimResults = true;
recognition.maxAlternatives = 1;
```

Expose a small language choice in dictation help/settings, defaulting to the browser language. Do not infer language from workspace locale or silently substitute a different language when unsupported. Continuous mode is a request, not a guarantee of unlimited listening. Keep v1 sessions short, with a proposed 120-second application cap and manual restart.

Use a concise first-use disclosure: “Your browser handles speech recognition and may send audio to its speech service.” Flow does not record or upload audio through its own APIs in this design. Do not claim anything about browser-provider retention that Flow cannot enforce.

### Strict-local variant

If audio must remain on the device, explicitly require `processLocally = true`. Check the local API surface, query language availability, offer a user-initiated language-pack installation when supported, and recheck availability after installation. Missing capability, unavailable language, or a denied download leaves dictation unavailable; there is no silent remote fallback. Language-pack downloading is a separate state from microphone permission. [On-device recognition guide](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API)

Local language setup may require another click to start recording after an asynchronous installation. Do not rely on a user activation surviving that operation. Verify the deployment's `on-device-speech-recognition` Permissions Policy when using these APIs. [Permissions Policy documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/on-device-speech-recognition)

### Alternatives and why they change scope

| Approach | Cost model | Tradeoff |
| --- | --- | --- |
| Browser-managed recognition | No paid API integration for Flow | Smallest implementation; browser/vendor/network dependencies. |
| Browser on-device recognition | No paid API integration | Stronger privacy, narrower device/language availability, language downloads. |
| Bundled local ASR model in a worker | Local compute; asset hosting costs | Broader control, substantial model download, memory, battery, and performance work. |
| Self-hosted transcription server | Compute and operational costs | No third-party per-call bill, but adds audio transport and infrastructure. |

A local WebAssembly engine is technically possible: whisper.cpp provides a browser example. It uses the Whisper model family, so it is an alternative only if the objection is paid APIs rather than all OpenAI-origin models. It is not the proposed v1 dependency. [Upstream browser example](https://github.com/ggml-org/whisper.cpp/blob/master/examples/whisper.wasm/README.md)

If a bundled engine becomes required, prototype before committing: microphone capture, resampling to the model's required format, worker-based inference, speech segmentation, overlapping-chunk deduplication, model cache/versioning, cancellation, and memory limits. Benchmark actual low-end target devices. Verify model and runtime licenses. This is a separate project, not an invisible fallback inside a simple button.

## 4. Architecture and data flow

```text
Microphone button
    -> useDictation: lifecycle + ownership + timers
    -> browserSpeechRecognition: browser API adapter
    -> result reducer: finalized delta + interim preview
    -> Composer draft transaction: plain-text splice
    -> existing Send / Save path, only after explicit user action
```

Proposed modules:

| File | Responsibility |
| --- | --- |
| `packages/web/src/lib/speechRecognition.ts` | Minimal local TypeScript interfaces, constructor detection, API creation and error normalization. |
| `packages/web/src/lib/dictationSession.ts` | Pure state transitions, result deduplication, insertion/length calculations. |
| `packages/web/src/lib/dictationCoordinator.ts` | One active owner across mounted composers; acquisition, cancellation, release. |
| `packages/web/src/hooks/useDictation.ts` | React lifecycle, stable refs, session tokens, timers, event binding and cleanup. |
| `packages/web/src/components/DictationButton.tsx` | Accessible mic/stop control and compact status/help presentation. |
| `packages/web/src/components/Composer.tsx` | Capture selection, apply finalized text, lock/unlock draft, guard Send and edit transitions. |
| Corresponding `.test.ts` / `.test.tsx` files | Deterministic unit and integration tests. |

Keep the adapter injectable so tests use a fake recognizer. Scope global browser typings narrowly rather than adding an untyped `any` surface or a speech wrapper library.

## 5. State machine and lifecycle

```text
unavailable
idle -> starting -> listening -> stopping -> idle
           |           |           |
           +-----------+-----------+-> error -> idle on explicit retry

Any active state -> abort/invalidate -> idle (or dispose)
```

Track `state`, `error`, `interimText`, `sessionId`, `ownerKey`, and a result ledger. Derive UI flags from state; avoid unrelated booleans that allow “listening and idle” simultaneously.

An owner key includes account identity, workspace ID, channel ID, thread root ID or main-composer sentinel, and edited-message ID or draft sentinel. A unique composer-instance token distinguishes remounts. A monotonically increasing session token distinguishes successive attempts by that owner.

Every callback verifies both the session token and the current owner key before touching the draft. Use current identity refs, not only the identity captured when creating a callback. Cleanup runs on identity change and unmount; guards also cover the interval before an effect cleanup runs.

### Starting

- Only a user click starts recognition; never start from mount effects.
- Capture editor selection before pointer focus moves to the microphone. Track the last valid selection for keyboard activation; use draft end only if there is no valid selection for this draft revision.
- Close emoji/autocomplete overlays and capture the current draft, selected range, and draft revision.
- Acquire the shared microphone owner. If another composer is active, cancel it and wait for termination or bounded cleanup before starting another recognizer. If it cannot terminate safely, report busy instead of allowing overlap.
- Construct a fresh recognizer per attempt; set handlers before calling `start()`.
- Catch synchronous start errors as well as asynchronous error events.
- Allow cancellation while permission is pending. If permission resolves after cancellation, stale-event guards prevent insertion and the recognizer is aborted again as needed.

### Stopping versus cancellation

A normal Stop calls `stop()` and accepts remaining finalized results until `end`. Cancellation invalidates the token first, calls `abort()`, and discards pending results. This distinction follows the browser API: Stop attempts a final result; Abort does not. [Stop semantics](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/stop)

Proposed configurable guards: 30-second start timeout, 5-second finalization timeout, and 120-second maximum session. These are product choices to validate on real browsers, not browser guarantees. On timeout, abort, clear timers, unlock editing, and preserve already committed text. Never promote uncertain interim words silently.

On tab hiding, navigation, logout, composer unmount, or entering/leaving edit mode: abort immediately. Do not treat ordinary window blur as navigation because microphone permission UI itself can change focus. Use `visibilitychange`/`pagehide` plus React lifecycle cleanup. Remove event handlers and release ownership idempotently.

The coordinator guarantees one recognizer within the current app document. Cross-tab coordination is outside v1; another tab's capture may result in a handled browser/device error.

## 6. Transcript insertion without duplicated or misplaced words

### Result handling

Browser recognition results are a session result list; interim entries can change or disappear. Do not append the entire result list on each event. Maintain result-index identity, process updates beginning at `resultIndex`, and commit each finalized index once. Rebuild the preview from the current non-final entries, removing entries that disappeared. Never deduplicate by transcript text: a user may intentionally repeat a phrase. [Result list semantics](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionEvent/results), [resultIndex](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionEvent/resultIndex)

Example:

```text
interim: "meet"
interim: "meet me"
final:   "meet me at noon"

Draft receives "meet me at noon" once.
```

### Draft transaction

At start, capture `{baseText, start, end, revision}`. The first nonempty final result replaces the selected range. Later finals extend the same dictated span. The untouched prefix and suffix remain byte-for-byte unchanged. If there are no final results, preserve the original selection and text.

Represent the expected draft as `prefix + dictatedSpan + suffix`. Before every commit, compare the current editor serialization with the last expected draft and validate owner identity. An unexpected change cancels recognition instead of overwriting that change. This protects against external edit loads even though manual typing is paused.

Apply updates through a refactored draft writer that can update DOM/state without focusing. Keep the existing focus behavior for ordinary paste, emoji, and keyboard actions. Restore focus only at normal completion, and only when the owner is still current; navigation cleanup must never steal focus.

Boundary spacing needs a tested function: preserve line breaks and existing whitespace; add a single separator between adjacent word-like text when necessary; do not add a space before closing punctuation or after opening punctuation. Preserve the engine's internal spacing and punctuation. Use Unicode-aware rules and language-specific behavior so CJK output is not automatically separated with English spaces. Do not capitalize or rewrite the user's original draft.

Insert with text nodes through existing helpers, never `innerHTML`. A transcript containing `<script>`, Markdown, or backticks is text. Do not route it through the native-input fence auto-close heuristic. Existing Markdown decoration and the ordinary outgoing transformation remain in effect.

Emit the existing throttled typing notification only when final text changes the draft. Interim text stays local and is excluded from `text`, Send, edit-save, clipboard operations, analytics, and message API payloads.

### Length and Undo

Check each insertion against the existing 12,000-character ceiling, including preserved draft text and spacing. Do not split surrogate pairs. Prefer stopping before an oversized final segment and displaying a recoverable overflow preview rather than silently clipping speech. Check the transformed outgoing body as well: mention expansion can change its length.

`setDraft()` rebuilds DOM, so native browser undo cannot be assumed to preserve a clean speech transaction. Include a temporary “Undo dictation” action after completion: it restores the pre-session draft only while the owner and expected completed draft still match. Dismiss/invalidate it on any subsequent edit, send, or navigation. Test existing Ctrl/Cmd+Z behavior; do not claim browser undo grouping without verification or expand this feature into a full editor-history rewrite.

## 7. Composer UI integration

Move the toolbar's `ml-auto` from the existing Send button to a right-aligned action group containing Mic then Send. Keep existing color tokens and match the compact style in the image. Use an inline SVG microphone and a stop icon; no icon package is necessary. Provide at least a 24-by-24 CSS-pixel target, preferably a 44-pixel touch target on mobile, while retaining the compact icon appearance.

Button requirements:

- `type="button"`, dynamic accessible label “Start dictation” / “Stop dictation”.
- `aria-pressed` for active capture and `aria-describedby` for status/help.
- Visible focus ring, hover tooltip “Dictate”, and active icon plus text so color is not the only signal.
- Test identifiers `${testPrefix}-dictate`, `${testPrefix}-dictation-status`, `${testPrefix}-dictation-interim`.
- A polite live region announces state transitions, not every interim word.
- Unsupported browsers expose an understandable unavailable state and keyboard-accessible help; typed chat remains available.

Keyboard handling must check dictation before autocomplete, code-block commands, edit Escape, or Send. Escape cancels active recognition before it can cancel an edited message. Enter must not submit during starting/listening/stopping. For the actual button, retain normal keyboard activation. A global dictation shortcut is deferred; the clipped reference image does not establish its keys or conflict behavior.

Guard all draft-changing paths, including emoji selection, mention insertion, paste, edit cancel, and parent-triggered edit loads. On edit-mode transitions, invalidate recognition before the new body is loaded or stashed text is restored. Test that initial text from another conversation cannot become the new owner's insertion base; if current composer reuse already carries a draft across identities, isolate/reset that lifecycle explicitly rather than adding a cross-chat draft cache as incidental scope.

## 8. Error and permission handling

| Condition | Behavior |
| --- | --- |
| Missing recognition constructor | Explain browser limitation; preserve typed chat. |
| Permission denied / policy blocked | “Microphone access is blocked. Check this site's microphone permissions.” No automatic retry loop. |
| No usable microphone / audio capture error | Explain device problem; preserve draft. |
| Network or speech-service failure | Explain recognition failed; manual retry available. |
| No speech / no match | “No speech detected. Try again.” Do not erase existing text. |
| Unsupported language | Offer language selection; do not silently change it. |
| User cancellation | Quiet normal exit; retain finals, discard interim. |
| Unexpected `end` | Finalize committed text and return idle; do not restart indefinitely. |
| Start throws / repeated click | Catch and normalize; state gate prevents duplicate starts. |
| Timeout | Abort, release ownership, preserve final text, show retry. |

Use HTTPS in production and localhost for development. Request recognition only through user interaction. Do not preflight with a separate `getUserMedia()` stream just to test permission: the browser recognizer owns its microphone capture. Do not assume `navigator.permissions` can reliably describe speech-service permission across browsers.

Keep errors separate from upload errors so dictation cannot clear another feature's failure notice. Log only optional non-content diagnostics such as capability, normalized error code, and duration. Never log audio or transcripts. Existing chat transmission happens only on normal explicit Send/Save.

## 9. Test strategy

### A. Pure unit tests in Vitest

Use a fake recognizer with controllable `start`, `result`, `error`, `end`, `stop`, and `abort`. Use fake timers for timeout cases.

| Area | Required cases |
| --- | --- |
| Capability | Standard constructor, prefixed constructor, no constructor, constructor exists but start fails. |
| Results | Interim revision/removal, multiple finals in one event, repeated events, repeated identical spoken phrases at different indices, new-session index reset. |
| Insertion | Empty draft, beginning/middle/end, selected text, multiline selection, punctuation, emoji, RTL text, CJK, code fences, whitespace-only results. |
| Limits | Exactly at limit, replacement frees space, segment exceeds limit, Unicode boundary, transformed-body expansion. |
| Lifecycle | Stop accepts final result, abort rejects final result, error followed by end, end without result, all timers cleaned. |
| Races | Old result after restart, old result after owner change, permission granted after cancellation, callbacks after unmount. |
| Ownership | Two composers cannot capture simultaneously; abort/release can run twice safely. |
| Undo | Restore original selection replacement; refuse undo after subsequent draft modification or owner change. |

### B. React/DOM integration tests

Add a scoped jsdom test environment and free dev-only React Testing Library utilities if needed. The repository currently has Vitest but not a configured DOM environment; include the harness work in the estimate.

Mount Composer with realistic provider fixtures and an injected fake recognizer. Assert visible draft text and submitted payloads, not just internal state:

1. Mic is immediately before Send and remains positioned in a narrow thread panel.
2. Clicking Mic preserves the caret/selection despite button focus.
3. Final speech updates both DOM and React-derived send state exactly once.
4. Interim text cannot enter outgoing requests.
5. Existing text, attachments, Markdown, and edit stashing survive a session.
6. Enter and mouse Send cannot bypass the busy guard.
7. Escape cancels speech before autocomplete/edit-mode Escape behavior.
8. Switching channel, workspace, account, or thread rejects old callbacks.
9. Main and thread composers cannot receive each other's transcripts.
10. Completion does not steal focus after navigation.
11. Strict Mode mount/cleanup causes no automatic recording or leaked callbacks.
12. Permission errors unlock typed input; retry creates a clean recognizer.

DOM emulation cannot prove real contenteditable selection or undo behavior across browsers. Keep those checks in actual-browser QA.

### C. Browser automation

No web Playwright setup was found in the inspected repository. If repeatable browser regression tests are included, add a small dev-only Playwright harness rather than assuming one exists. Inject a fake browser recognition constructor before app initialization, then run the actual composer UI with controlled events.

Cover caret replacement, focus transfer, thread/channel isolation, no implicit send, stop-finalization, and late results after navigation in Chromium; run applicable DOM/fallback tests in WebKit and Firefox. Injected support validates integration, not actual browser speech availability. Do not make CI depend on real microphones, network speech services, or exact acoustic transcription.

### D. Real microphone acceptance matrix

Test current stable Chrome and Edge on Windows, Safari on macOS, Chrome on Android, Safari on iOS, and Firefox's unsupported/fallback behavior. Record exact OS/browser versions, locale, recognition mode, and pass/fail evidence; do not infer support from the engine name.

Scenarios: first permission grant, denied permission, OS-level microphone block, missing/unplugged headset, silence, noise, network interruption, 30-second dictation, application time cap, rapid repeated sessions, app backgrounding, language mismatch, channel switch, thread closure, and edit mode. For local mode also test missing language pack, installation failure, and offline recognition after a successful install.

Use short human-reviewed phrases containing numbers, punctuation, names, and repeated words. Judge whether text is usable and routed correctly; do not assert an exact transcript from a nondeterministic browser service. Establish latency targets during the browser spike, then record median and worst observed startup/finalization times. Adapter-to-DOM handling should remain fast and avoid rebuilding the editor for interim-only changes.

### Verification commands during implementation

```sh
pnpm --filter @flow/web test
pnpm --filter @flow/web build
pnpm build
pnpm test
```

Run targeted checks first, then repository-required checks before a PR. Report any environment-dependent failures explicitly. This planning task did not execute implementation tests or claim they pass.

## 10. Native client extension

Web changes will not add buttons to the SwiftUI apps. Track native parity explicitly.

For a later native implementation, preserve the same UX and session ownership contract, using Apple's Speech framework with an audio capture service, permission declarations, appropriate entitlements, and platform audio-session interruption handling. Integrate separately into `apps/macos/Sources/Flow/Views/ComposerView.swift` and `apps/ios/Sources/Views/ComposerView.swift`; avoid sharing microphone ownership with unrelated voice-call code implicitly.

For the existing SFSpeechRecognizer route, strict-local use requires checking `supportsOnDeviceRecognition` before setting `requiresOnDeviceRecognition`; unsupported devices/languages cannot satisfy that promise. Confirm API choice against the actual deployment targets before implementation. [Apple's on-device capability documentation](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition)

Native QA must additionally cover app backgrounding, phone calls/audio interruptions, microphone contention, permission revocation, and real-device tests. Native work needs a separate estimate after inspecting its capture and text-selection integration in depth.

## 11. Delivery sequence and estimate

Estimates below are engineering estimates for one developer, not measured delivery commitments.

| Phase | Deliverable and exit condition | Estimate |
| --- | --- | --- |
| 1. Browser spike | Verify recognition on intended Windows/browser combination; establish remote-versus-local choice and unsupported UX. | 0.5–1 day |
| 2. Recognition core | Adapter, reducer, ownership coordinator, timers, unit tests. | 1–1.5 days |
| 3. Composer integration | Placement, selection capture, final insertion, preview, cancellation, edit/send guards, Undo action. | 1–2 days |
| 4. Integration and device QA | DOM harness, regression cases, real microphone/browser matrix, accessibility fixes. | 1–2 days |
| 5. Release preparation | Full checks, screenshots, documentation and parity entries. | 0.5 day |

Budget approximately 4–7 working days for a tested web release. A working demo is much smaller; reliable draft isolation, selection handling, and browser validation account for most of the effort. A new Playwright harness, strict-local download UX, or native clients may extend this estimate and should be tracked explicitly.

During implementation, add succinct dated entries to `CHANGELOG.md` and `FEATURES.md`, record the recognition/privacy choice in `decision_log.md`, and include the repository's visible-impact checklist and native parity status in the PR. The planning document itself does not announce a shipped feature.

Roll out to the browser/device combinations actually verified. Keep capability/error fallback in place everywhere else. Reverting the frontend feature does not require a database rollback because no schema or transcription backend is introduced.

## 12. Definition of done

- A mic button sits directly beside Send in channel, DM, and thread composers.
- A user can dictate, stop, correct the draft, and explicitly send or save it.
- No paid speech SDK, API key, or paid transcription endpoint is required.
- Product copy accurately distinguishes browser-managed recognition from local processing.
- Final phrases appear once at the captured insertion point; existing draft content is preserved.
- No interim or late result can submit itself or land in another chat/edit target.
- Denial, unsupported environments, interruption, timeout, and navigation always release app ownership and restore typed input.
- Unit/integration tests and real-browser microphone checks have recorded results.
- Client parity and release notes accurately describe what shipped.

Recommendation: ship browser-managed recognition first if the requirement is zero paid API integration. If the requirement is zero external audio processing, ship strict-local capability gating and accept narrower availability; do not disguise that product tradeoff.
