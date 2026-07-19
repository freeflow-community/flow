# Flow

Flow is a production-grade Slack clone: a high-performance messaging backend
with encryption at rest, a native macOS client, and a web client — all kept in
lockstep feature parity.

![status](https://img.shields.io/badge/status-active_development-blue)

## Features

- **Core messaging** — workspaces, public/private channels, message replies and
  threads, unread tracking, presence and typing indicators
- **Direct messages** — 1:1 DMs, private group DMs, and a persistent self-DM
- **Rich chat** — Markdown styling live in the composer (quotes, code fences
  with an enterable code-block editor), emoji shortcodes, emoji reactions,
  `@user` / `@channel` / `@here` / `@everyone` mentions with notifications
- **Files** — uploads encrypted at rest, drag-and-drop and paste attach, inline
  image cards with lightbox, animated GIF playback, text-file and PDF previews
  with an in-app reader, one-click download
- **Users** — profiles (name, email, timezone, avatar), user status
  (emoji + label) broadcast live, invites via `flow://invite/<token>` links
- **Workspaces** — users can join multiple workspaces; admin-set workspace-wide
  sidebar color themes
- **Slack API compatibility** — admin-created apps with `xoxb-` bot tokens,
  17 Slack Web API methods at `POST /api/*` (verified against the official
  `@slack/web-api` SDK), and an Events API with HMAC v0 signatures, retries,
  and challenge verification
- **Web-to-app auth handoff** — sign in on the web, then deep-link into the
  desktop app via a single-use short-lived code (raw tokens never ride in URLs)

Deliberate non-goals (see `overview.md`): Canvas, BlockKit, huddles/audio/video,
message search, drafts, external/guest connections.

## Architecture

pnpm monorepo (Node ≥ 22) plus a SwiftPM package for the native client:

```
packages/
  server/   Fastify 5 + Drizzle ORM + Postgres 16 + NATS — REST API, WebSocket
            gateway, Slack-compat API, encrypted message/file storage
  web/      React 19 + Vite + Tailwind 4 + TanStack Query — online-only web
            client, served from the API server in production
  shared/   Zod schemas and types shared between server and web
  infra/    docker-compose for Postgres (host port 5442) and NATS
apps/
  macos/    SwiftUI (macOS 14+, Swift 6) — offline-capable native client with
            a GRDB/SQLite cache, SyncEngine, optimistic send, Keychain
            sessions, and flow:// deep links
```

Clients talk to the server over REST (`http://127.0.0.1:8787`) and a WebSocket
(`/v1/ws`) for real-time events; NATS fans events out server-side. Messages and
file blobs are encrypted at rest in Postgres.

## Getting started

Prerequisites: Node 22+, pnpm 10, Docker, and (for the native client)
macOS 14+ with Xcode 26.

```sh
# 1. Infrastructure (Postgres on host port 5442, NATS)
cd packages/infra && docker compose up -d

# 2. Install and build
pnpm install
pnpm build

# 3. Run the server (serves the API, WebSocket, and the built web client)
cd packages/server
pnpm migrate
pnpm dev            # http://127.0.0.1:8787
```

Open `http://127.0.0.1:8787` in a browser to use the web client. After
rebuilding `packages/web/dist`, restart the server to pick it up.

### macOS app

```sh
cd apps/macos
swift run Flow            # run directly, or open Package.swift in Xcode
tools/make-app.sh         # package dist/Flow.app (registers flow:// links)
```

See `apps/macos/README.md` for details (cache location, Keychain, invites).

### Tests

```sh
pnpm test                 # server test suite (vitest)
cd apps/macos && swift test   # live-server smoke test against 127.0.0.1:8787
```

## Client parity

Every feature ships on both clients or gets an explicit entry in the
**Parity** section of `CHANGELOG.md` — either a gap to close or a ruled,
deliberate divergence (e.g. web uses a custom emoji picker while macOS uses the
native character palette). QA verifies parity at each phase checkpoint.

## Project docs

- `overview.md` — product scope and non-goals
- `phase1.md` … `phase6.md` — the architecture plan and build phases
- `CHANGELOG.md` — per-platform history (`[server]` `[web]` `[macos]` `[qa]`)
  and the live parity ledger
- `decision_log.md` — key decisions and operator rulings
- `CLAUDE.md` — working conventions for agents contributing to the repo

## Status

Phases 1–6 are complete: foundation, DMs/reactions/files/mentions, the design
retheme and status system, Slack app compatibility, attachment/thread UX, and
text/PDF previews — plus the MyChat → Flow deep rename and the web-to-app auth
handoff. See `CHANGELOG.md` for the full history.
