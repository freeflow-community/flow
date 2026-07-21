# Phase 9 implementation plan — Artifact tabs

Spec: `docs/specs/phase9.md`. Built on branch `worktree-phase9-artifacts`, shipped in
PRs #4–#6.

> **Status: as-built.** This was the pre-build plan; the data-model section and rulings
> below have been updated to match what shipped. The step-by-step (Steps 1–5) is kept as
> the original intent — a few specifics changed during implementation (see the "Diverged
> from plan" notes). Authoritative record of decisions is `decision_log.md`.

## Data model decision (as built — see decision_log.md 2026-07-21)

An **artifact is a named reference to an existing `files` row** (a bookmark), **personal
and per-user**: each row is owned by one user and appears only in that user's sidebar.
File bytes remain guarded by `requireFileAccess` at render time — holding an artifact is
itself a read grant (PR #5). Removing an artifact never deletes the file.

**Agent-created artifacts go to one recipient, not a channel.** The MCP `create_artifact`
tool uploads (or reuses) a file and creates a single artifact in one person's sidebar —
by default the user the agent is responding to. The original plan fanned out one row per
human channel member; that was corrected to single-recipient during the build (decision
log 2026-07-21, PR #6). macOS parity ships in this phase.

## Step 1 — Server: table + service + routes + events

- `packages/server/src/db/migrations/0016_artifacts.sql` + `pgTable` in `db/schema.ts`
  (mirror `reactions`, schema.ts:186). _Diverged from plan:_ shipped as `id, userId,
  workspaceId, fileId → files.id (cascade), name, createdAt` with a unique `(userId,
  fileId)` index — no `channelId` (artifacts are personal, not channel-scoped) and the
  owner is `userId`, not `createdBy`.
- `packages/shared/src/dto.ts`: `ArtifactDTO` (embed the `FileDTO` so clients can render
  without a second fetch). `packages/shared/src/schemas.ts`: `CreateArtifactBody
  { fileId, name? }` (name defaults to file name).
- `packages/server/src/services/artifacts.ts`: `createArtifact` (guard with
  `requireFileAccess`, idempotent on duplicate fileId per user), `listArtifacts(workspaceId,
  userId)` (filtered to channels the user is in), `deleteArtifact`, `renameArtifact`.
  Publish events after writes (mirror `services/reactions.ts:36`).
- Routes in `packages/server/src/routes/index.ts`: `POST /v1/artifacts`,
  `GET /v1/workspaces/:id/artifacts`, `PATCH /v1/artifacts/:id`, `DELETE /v1/artifacts/:id`.
- `packages/shared/src/events.ts`: add `artifact.created` / `artifact.updated` /
  `artifact.deleted` to `EventType` + data type. _Diverged from plan:_ published on the
  **per-user notify subject** (`subjectUserNotify`), not the channel subject — artifacts
  are personal, so only the owner's own clients should hear about them.

## Step 2 — Web: sidebar section + artifact panel + bookmark action

- `packages/web/src/lib/hooks.ts`: `useArtifacts(workspaceId)`; api helpers for
  create/delete/rename.
- Selection: add `artifactId` to `Selection` (`state.tsx:20`) with setter in `App.tsx`
  (persist like `flow.activeWorkspace`); selecting an artifact clears channel selection and
  vice versa (follow the `ADMIN_VIEW_ID` sentinel pattern, `Main.tsx:209`).
- `Sidebar.tsx`: new `<SectionHeader label="Artifacts"/>` + rows (name + type glyph,
  hover ✕ to remove) between DMs and Browse.
- New `components/ArtifactView.tsx`, branched from `Main.tsx`: dispatch on
  `file.mimeType`/extension reusing the machinery already in `MessageList.tsx`
  (`blobUrl`, `fileStreamUrl`, `fileText`, PDF `<embed>`; detection helpers
  `isTextFile`/`isVideoFile`, MessageList.tsx:382–463 — consider extracting these to a
  shared module rather than importing from MessageList). **Net-new renderer: sandboxed
  HTML `<iframe>`** (`sandbox="allow-scripts"`, `srcdoc` from `fileText`, no same-origin).
- `MessageList.tsx` hover toolbar (L286–326): add 🔖 button on messages that have files
  (per-file if multiple); on click `POST /v1/artifacts` then auto-select the new artifact
  (spec: panel selected automatically).
- `Main.tsx handleEvent`: `artifact.*` → invalidate `['artifacts', workspaceId]`; if a
  selected artifact is deleted, clear selection.

## Step 3 — MCP: agents create artifacts

- `packages/agent-bridge/src/api.ts`: `FlowApi.shareArtifactWith(userId, fileId, name?)`
  → `POST /v1/artifacts/share`.
- `packages/agent-bridge/src/mcp-server.ts`: new tool `create_artifact` in `TOOLS` +
  `callTool` case. Input: `{ name, content?, mimeType?, path?, fileId?, userId? }` —
  supply a file as inline `content`, a local `path`, or an existing `fileId`; recipient
  defaults to the current conversation's user (`FLOW_USER_ID`, injected by the bridge).
- _Diverged from plan:_ single recipient, not a channel fan-out (PR #6). Authorization is
  "caller shares a channel with the recipient", enforced server-side in
  `shareArtifactWith`; no conversation context required.

## Step 4 — macOS parity (ships this phase)

- `SidebarView.swift`: "Artifacts" section (reuse `sectionHeader`).
- `AppState.swift`: `selectedArtifactId` + selection routing alongside `selectChannel`.
- `Models.swift` / `APIClient.swift` / `SyncEngine.swift`: Artifact model, CRUD calls,
  `artifact.*` event handling.
- Panel view reusing `FilePreviews.swift` renderers; HTML via `WKWebView`.

## Step 5 — Close-out

- `CHANGELOG.md`: `[server]` `[web]` `[macos]` entries; Parity section stays clean
  (both clients land together).
- QA checkpoint per CLAUDE.md; migration runs via existing `migrate.ts` runner.

## Operator rulings (2026-07-21)

1. Artifacts are personal per-user bookmarks.
2. Removing an artifact never deletes the underlying file.
3. macOS parity ships in this phase.
4. `create_artifact` targets **one recipient**, not every human member of the channel
   (correction during build — superseded the original fan-out design; PR #6).

## Follow-on fixes (post-merge, same day)

- **PR #5** — an artifact bookmark is itself a read grant in `requireFileAccess`.
  Agent-created files are never attached to a message, so recipients were locked out of
  their own artifacts (panel fell back to a download card that 404'd).
- **PR #6** — the single-recipient correction above (ruling 4).
