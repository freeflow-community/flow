# Changelog

Convention: every feature/fix entry tags the platforms it landed on —
`[server]` `[web]` `[macos]` `[qa]`. A change that lands on one client but not
the other MUST add a line to **Parity** below (and remove it when closed).
Updated with every milestone commit (PM) and interactive-session fix (coordinator).

## Parity

### Gaps to close
- Web composer: browser-native undo degrades after programmatic splices
  (autocomplete/suggestion inserts) — contenteditable limitation; macOS undo is clean.
- macOS: pasting a non-image file URL inserts its path as text; web handles
  arbitrary files via drop/picker. (Drag-drop attach works on both.)
- Web: one session token per browser origin — two accounts in two tabs collide
  (macOS profiles handle multi-account). Candidate phase-3-adjacent fix.
- macOS: workspace-chooser tiles ignore AX activation (real click required) — a11y gap.
- No syntax highlighting in code blocks (both clients; never scoped).

### Deliberate divergences (ruled)
- Emoji picker: custom grid + search on web; native character palette on macOS.
- App management UI (Slack-compat apps): web only.
- Sidebar width preference: local per device, not synced (ruled).

## History

### 2026-07-19 — interactive fixes (operator session)
- Code blocks: ``` auto-materializes an enterable block (fences hidden, caret
  inside); Return types code lines, Return on empty line submits, → exits the
  block, Esc/Delete removes an empty block. `[web] [macos]`
- Composer: drag-and-drop files attach (was: path text). `[web] [macos]`
- Emoji/mention autocomplete: vertical list, first match pre-selected,
  Enter/Tab inserts, arrows navigate, Esc dismisses. `[web] [macos]`
- Sidebar: Members section removed; persistent "<Name> (you)" self-DM;
  profile via DM context menu. `[web] [macos]`
- Active workspace persisted + restored; first open lands on #general. `[web] [macos]`
- macOS channel header: design-3a member avatar stack + "+N". `[macos]` (web already had it)
- Keychain: double prompt fixed (no token rewrite at bootstrap); stable
  "MyChat Dev Signing" identity — no prompts after rebuilds. `[macos]`

### 2026-07-19 — Phase 4: Slack app compatibility
- Admin-created apps, one-time xoxb- tokens, bot users as real users. `[server] [web] [qa]`
- 17 Slack Web API methods at POST /api/* (Slack envelopes/errors, ts codec,
  mrkdwn converter); verified with the official @slack/web-api SDK. `[server] [qa]`
- Events API: Postgres outbox, v0 HMAC signatures, retries, auto-disable,
  challenge verification; 10 event types. `[server] [qa]`
- Key-rotation CLI deferred to phase 3 (operator ruling).

### 2026-07-18/19 — Phase 3.5: features + design adoption
- Design 3a "Quiet, in violet" retheme. `[web] [macos]`
- User status (emoji + label): picker, sidebar/chat/footer display, live
  broadcast. `[server] [web] [macos] [qa]`
- Member-click opens DM; profiles via context menus + DM headers. `[web] [macos]`
- Footer split: avatar = user menu; rest = status picker. `[web] [macos]`
- Image paste into composer. `[web] [macos]`
- Workspace-wide sidebar color (8 presets, admin-set, live broadcast).
  `[server] [web] [macos] [qa]`
- Resizable sidebar (180–360, double-click reset, local pref). `[web] [macos]`
- Live in-composer markdown styling (> quotes, ``` fences) + styled message
  rendering; fence-aware mention/shortcode transforms. `[web] [macos]`

### 2026-07-18 — Phase 2: DMs, reactions, files, mentions, web client
- DMs (1:1/group), reactions, encrypted files + thumbnails, mentions incl.
  @channel/@here/@everyone, notifications + notify levels, membership
  management/archive, profiles (name/timezone/avatar). `[server] [web] [macos] [qa]`
- Web client (React 19 + Vite + Tailwind, online-only, Fastify-served). `[web]`
- macOS .app packaging (banners, myapp:// scheme). `[macos]`

### 2026-07-18 — Phase 1: foundation
- Backend (Fastify/Drizzle/Postgres/NATS/WS, encrypted messages, workspaces/
  channels/threads/unread/presence) + macOS SwiftUI client (SyncEngine, GRDB
  cache, optimistic send). `[server] [macos]`
