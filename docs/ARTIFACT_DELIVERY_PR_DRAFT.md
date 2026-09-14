# PR title

fix: reliably create, deliver, and render agent reports

# PR description

Prism can claim a report is complete while the conversation contains only a downloadable Markdown attachment. The current web artifact viewer also renders Markdown as raw text, and automatic opening depends on a live event and file ownership. Users therefore cannot reliably read the requested report and comparison matrix directly in Flow.

This change turns report delivery into a verified workflow: the bridge creates a persisted artifact, posts an idempotent **Open report** card in the source conversation, and returns saved/delivered status. Markdown reports render as documents with comparison tables; cards reopen through an authorized detail endpoint after refresh, reconnect, or a missed event.

The investigation identifies code-level gaps but does not establish whether the historical report was persisted in the deployed database.

## Included changes

- Add explicit requester, source-thread, and idempotency metadata to artifacts, with a migration and authorized artifact-detail endpoint.
- Add MCP report delivery: `create_artifact` now posts an Open report card, `deliver_artifact` retries delivery, and `list_artifacts` supports update-in-place workflows.
- Render Markdown artifacts and legacy Markdown attachments as reports on web; support table rendering and safe Open report cards.
- Update macOS and iOS report opening/rendering paths.
- Add a compact, searchable Docs collection per channel.
- Correct agent guidance so uploads cannot be presented as report delivery.
- Add focused bridge, web, and server integration coverage; retain the implementation plan as supporting design documentation.

## Implementation checklist

These behaviors are implemented in this change.

- [x] Define a persistent delivery contract linking artifact, source conversation/thread, requester, and a stable operation ID.
- [x] Implement idempotent creation and delivery with recovery from partial failures.
- [x] Return structured results and add artifact lookup so revisions update the same report.
- [x] Persist artifact references in messages and render an Open report card.
- [x] Add a Markdown report viewer with tables and safe link handling.
- [x] Separate display title, backing filename, and content format.
- [x] Replace ownership-based auto-open with explicit requester delivery context.
- [x] Support reopening independently of live events and stale list caches.
- [x] Correct the bridge prompt, MCP descriptions, and shipped agent guidance.
- [x] Add native report opening and Markdown/text rendering paths.
- [x] Add a compact, searchable Docs collection and preserve update-in-place behavior.

## Definition of done for implementation

- A report request creates exactly one persistent artifact and one working card in the correct conversation.
- The comparison matrix displays as a readable table, with downloading offered as a secondary action.
- The requester can open the report immediately and after refresh, reconnect, or a missed event.
- Other channel members do not lose focus when the report arrives.
- Follow-up revisions preserve artifact identity; retried delivery does not create duplicates.
- Failures show truthful status and recovery actions without a false completion claim.
- Existing Markdown artifacts render without recreation, and inaccessible/deleted content has explicit states.

## Validation

Focused bridge delivery tests and web report-rendering tests pass. TypeScript checks pass for shared, server, web, and agent-bridge. The server integration suite could not run because local PostgreSQL is unavailable on port 5442. Native app compilation and visual validation require Apple build infrastructure.

## Review boundaries

Existing unrelated working-tree changes are excluded. Production incident verification, server integration, and native runtime validation remain outstanding.

---

Local preparation status: this is a copy-ready PR draft, not a GitHub PR. Nothing has been staged, committed, pushed, or published.
