# Artifact creation, rendering, and delivery fix plan

Status: implemented locally and awaiting review. No commits or pushes.

## Expected outcome

When someone asks Prism to build a comparison matrix and report, Prism creates a persistent report, renders the matrix as a table, and delivers an Open report card in the originating conversation. The requester can read it immediately and reopen it after refresh. Downloading Markdown is an optional export. A follow-up revises the same report unless the user asks for a separate one.

The two supplied screenshots are evidence of user-visible behavior, not instructions to execute the earlier Flow-versus-Slack research request. They show a completion claim followed by a missing-deliverable complaint and a Markdown attachment. They do not establish whether the artifact database row actually existed.

## Findings in the current checkout

1. **Markdown is not rendered in the artifact viewer.** `packages/web/src/components/ArtifactView.tsx` routes text files to `TextPane`, which uses a `<pre>`. `lib/fileKind.ts` includes Markdown among text formats. The macOS `ArtifactPanelView.swift` similarly routes text to its text pane. Thus the claim that the Markdown artifact opens with rendered formatting does not match this web implementation.
2. **Uploading and creating are separate operations.** In `packages/agent-bridge/src/mcp-server.ts`, `upload_file` uploads and posts a file attachment; it does not create an artifact. `create_artifact` persists an artifact and returns a textual name/ID, without posting a durable artifact card into the originating thread.
3. **Auto-open exists, with incomplete semantics.** `packages/web/src/components/Main.tsx` opens on `artifact.created` only when `ownsFile` is true and the channel is active. It already seeds the cache before selecting to avoid an immediate close. Creating from an existing `fileId` sets ownership false, so that path skips auto-open. Ownership governs file cleanup and should not double as requester/open intent. Current selection also targets active channel viewers rather than an identified requester. A missed live event is not a durable delivery mechanism.
4. **Agent guidance is stale.** `skills/flow-agent-member/SKILL.md` describes personal artifacts and a `userId` recipient, while the MCP schema and server use `channelId`. The bridge prompt lists tools but does not establish a verified report-delivery contract.
5. **The sidebar grows with artifact count.** `Sidebar.tsx` renders each channel's artifacts as rows. Organization needs improvement, but should not delay fixing report creation and access.

No production logs, database records, or deployed revision were inspected. The precise cause of this historical creation claim remains unverified. Existing unrelated local changes must be preserved.

## Implemented design

### 1. Delivery evidence and recovery

- Added report fixtures with headings, a comparison table, links, and a conclusion. They cover inline content and legacy Markdown-file detection. Server-level integration coverage covers storage, delivery metadata, reopening, requester authorization, retry convergence, and invalid thread context.
- Creation returns structured saved/delivered status. The acknowledgement explicitly does not claim that a client has rendered the document.
- Production-incident attribution remains open: deployed revision and historical records were not available in this checkout.

### 2. Create and publish a report as one reliable workflow

- Added explicit requester, source-thread, and operation IDs to artifacts. File ownership remains only a file-lifecycle flag.
- `create_artifact` now saves the report and posts an idempotent **Open report** card in the originating conversation. `deliver_artifact` retries only the card; `list_artifacts` finds a report to update.
- Added a stable operation ID for creation and a stable client-message ID for card delivery. A concurrent or retried creation returns the original artifact and reaps a surplus owned upload.
- Added authorized `GET /v1/artifacts/:id`, allowing cards to reopen documents after refresh, reconnect, a missed live event, or a stale artifact-list cache.
- Updated bridge prompting and the shipped Flow agent skill so a file upload alone cannot be presented as report delivery.

### 3. Render the report

- Reused Flow's existing safe Markdown block renderer for Web report documents, including headings, tables, code, quotes, links, and wide-table scrolling. Raw HTML is not executed. Intentional HTML artifacts remain sandboxed.
- Inline reports default to Markdown. Display title, backing filename, and MIME type are independent.
- Existing `.md` and `text/markdown` files render as reports in both the artifact pane and attachment preview, without recreating them.
- Added native report-card opening and Markdown/text viewers. macOS renders reports beside the conversation; iOS opens them in a sheet. Native compilation still requires Apple build infrastructure.

### 4. Make opening reliable

- Durable report references are rendered as application buttons, not file downloads or web links.
- Auto-open now requires the exact requester, channel, and source thread. A report card remains available for everyone else or when the requester has navigated away.
- The detail endpoint backs opening. The web client retains clear load/access/deleted error states and retry actions.

### 5. Keep the collection manageable

- Replaced unbounded sidebar rows with a collapsible per-channel Docs section, document count, search field, scrollable results, and most-recently-updated ordering.
- Updating preserves artifact identity. Archiving is intentionally out of scope.

## Acceptance checks

- [x] A report creation produces one artifact and a durable card in the source conversation; the fixture table renders.
- [x] Inline and existing-file delivery have stable operation identities. Local-path delivery shares the same resolver.
- [x] Reopening uses an authorized detail endpoint, independent of a live event or a stale artifact list.
- [x] Card delivery retries reuse the same message ID; creation retries reuse the same artifact operation.
- [x] Delivery failure is reported as saved-but-undelivered, without a false rendering acknowledgement.
- [x] Only the intended requester auto-opens, and only when viewing the exact conversation. Raw HTML and unsafe links do not execute in the Markdown renderer.
- [x] Focused web and bridge tests pass; TypeScript is clean across shared, server, web, and bridge packages.
- [ ] Run server integration tests with PostgreSQL on port 5442.
- [ ] Run macOS and iOS build/test suites and visually inspect the report fixture at narrow and wide widths.

## Rendering and isolation references

- `packages/web/src/lib/format.tsx`: Flow's safe block renderer, including comparison-table parsing.
- `packages/web/src/components/ArtifactView.tsx`: report routing and the existing sandboxed HTML-document path.
- [MDN `srcdoc` documentation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/srcdoc): isolation requirements for HTML artifacts.

The implementation is ready for review, subject to the environment-specific checks listed above.
