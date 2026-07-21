# Phase 7 — iOS parity: vertical slice → daily driver (PROPOSED)

The iOS app (IOS.md) signs in, lists channels/DMs, reads and sends messages.
This phase closes the CHANGELOG parity gaps so it's usable as a real client.
Everything in tiers 1–2 is **view work only** — the shared data layer
(Models/APIClient/SocketClient/GRDB/SyncEngine) already speaks the full
protocol, so no server changes except where noted in tier 3.

## Tier 1 — core messaging parity (highest value, pure views)

1. **Message actions via long-press** (iOS's answer to the hover menu):
   context menu with React, Reply in thread, Edit (own), Delete (own, with
   confirm). Reuses SyncEngine mutations that macOS already calls.
2. **Reactions**: chips with counts under messages, tap to toggle; reaction
   picker from the long-press menu (reuse shared EmojiCatalog; simple grid +
   search, like web).
3. **Threads**: reply count + participant-avatar stack on parent messages
   (DTO field already synced); tapping pushes a thread screen (navigation
   push, not a side panel — phones) with its own composer.
4. **Rich markdown rendering**: shared MarkdownBlocks segmentation already
   compiles on iOS — port the segment views from macOS MessageListView
   (bold/italic/inline code, code blocks, blockquotes, mention pills).
5. **Typing indicators**: send on compose (SyncEngine.typing exists) + render
   the indicator row; same 5s expiry semantics as web/macOS.

## Tier 2 — files

6. **Render attachments in chat**: image previews (AuthImage port exists) with
   tap-to-lightbox; text/PDF files via QuickLook (`QLPreviewController`) —
   iOS-native equivalent of the phase-6 preview cards, not a pixel port.
7. **Upload**: PhotosPicker (photo library) + camera + Files app document
   picker, routed through the existing upload pipeline; thumbnails in the
   composer like macOS.

## Tier 3 — native-platform features (needs server work / rulings)

8. **Push notifications (APNs)** — the one gap that is NOT view work: server
   needs a device-token registry + APNs sender wired to the existing
   notification fan-out, plus an Apple push key. Simulator can't do real APNs;
   needs the physical-device dev setup from IOS.md. Proposal: separate
   follow-on phase unless ruled in now.
9. **Unread polish**: app-icon badge count, mark-read on scroll — cheap once
   in-app unreads are trusted.

## Explicitly out (parity by design)

- In-app registration / password reset / passwordless link — web is the auth
  surface on iOS exactly like macOS (flow://signin handoff already works).
- App management UI — web-only (ruled divergence).

## Verification

- Headless simulator QA via the DEBUG env hooks (FLOW_DEBUG_EMAIL/PASSWORD/
  OPEN_CHANNEL/SEND) against the local QA server + alice responder for
  threads/reactions/typing round-trips.
- swift test (shared layer) must stay green; CHANGELOG Parity section updated
  — the iOS gap line should shrink to just push notifications (if deferred).

## Pre-flight questions (operator)

1. Push notifications: in this phase, follow-on phase, or park? (server work +
   Apple push key + device testing)
2. Files scope: photo library only, or full trio (camera + Files picker)?
3. Composer: plain text with markdown characters (ship faster), or port the
   live-styled NSTextView composer behavior (fences, autocomplete) to UIKit?
   Recommendation: plain text + @-mention autocomplete only, this phase.
4. Edit UX: sheet editor like macOS, or inline? Recommendation: sheet.
