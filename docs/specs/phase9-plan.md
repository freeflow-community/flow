# Phase 9 implementation plan — Artifact tabs

Spec: `docs/specs/phase9.md`. Branch: `worktree-phase9-artifacts`.

## Data model decision (operator-ratified 2026-07-21, see decision_log.md)

An **artifact is a named reference to an existing `files` row** (a bookmark), **personal
and per-user**: each row is owned by one user and appears only in that user's sidebar.
File bytes remain guarded by `requireFileAccess` at render time. Removing an artifact
never deletes the file. Agent-created artifacts reuse the existing upload pipeline
(upload file → create artifact), fanning out one personal row per human member of the
current channel. macOS parity ships in this phase.

## Step 1 — Server: table + service + routes + events

- `packages/server/src/db/migrations/0016_artifacts.sql` + `pgTable` in `db/schema.ts`
  (mirror `reactions`, schema.ts:186): `id, workspaceId, channelId, fileId → files.id
  (cascade), name, createdBy, createdAt`.
- `packages/shared/src/dto.ts`: `ArtifactDTO` (embed the `FileDTO` so clients can render
  without a second fetch). `packages/shared/src/schemas.ts`: `CreateArtifactBody
  { fileId, name? }` (name defaults to file name).
- `packages/server/src/services/artifacts.ts`: `createArtifact` (guard with
  `requireFileAccess`, idempotent on duplicate fileId per user), `listArtifacts(workspaceId,
  userId)` (filtered to channels the user is in), `deleteArtifact`, `renameArtifact`.
  Publish events after writes (mirror `services/reactions.ts:36`).
- Routes in `packages/server/src/routes/index.ts`: `POST /v1/artifacts`,
  `GET /v1/workspaces/:id/artifacts`, `PATCH /v1/artifacts/:id`, `DELETE /v1/artifacts/:id`.
- `packages/shared/src/events.ts`: add `artifact.created` / `artifact.deleted` to
  `EventType` + data type; publish on the channel subject (`subjectMsg`) so gateway
  visibility filtering applies.

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

- `packages/agent-bridge/src/api.ts`: `FlowApi.createArtifact(fileId, name?)`.
- `packages/agent-bridge/src/mcp-server.ts`: new tool `create_artifact` in `TOOLS` +
  `callTool` case. Input: `{ name, content?, mime_type?, file_id? }` — either bookmark an
  already-uploaded file, or inline `content` which we route through the existing
  `FlowApi.uploadFile` then create the artifact. Operator tests manually after wiring.

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
