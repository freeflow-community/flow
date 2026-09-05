# PR draft: Discuss shared documents inside an ongoing bot Huddle

Status: local implementation and automated checks complete; live-call acceptance
is still pending. No GitHub PR, push, merge, deployment or live DM was performed
for this follow-up.

Local branch: `codex/huddle-shared-context`.
Base: `630faaf` on the existing `codex/bridge-runtime-huddle` work, not a fresh
main checkout. Review this follow-up against that base; it depends on the
existing bridge-runtime Huddle implementation. Recheck the eventual target
branch before publishing; this work does not merge or rebase anything.

## User experience

While in a one-to-one Huddle with the bot, send text, a file, or a file artifact
in the same DM. Ask, “I just sent this; could you take a look?” The bridge makes
the material available to the continuing call and speaks its response instead
of enqueueing a duplicate chat response. Newly shared material schedules a
short spoken update when both sides are idle. If preparation is still running,
the bot receives that status and can follow up when it finishes.

This uses the existing authenticated Claude/Codex bridge runtime. It introduces
no model API-key setup. LiveKit still provides the speech transport and inference
using the existing server-minted token; a working Huddle deployment remains a
prerequisite. Existing bridge slash commands keep their behavior.

## Implementation

- A call-scoped inbox admits only the caller's messages and artifacts belonging
  to the active DM. Gateway create/update/delete events and reconnect snapshots
  update it. Version checks prevent stale events from restoring old content.
- File downloads use the existing authorized endpoint, a streaming byte cap,
  hangup cancellation and a timeout. A separate cancellable worker prepares
  documents without blocking audio processing.
- Text, PDF, images, DOCX and XLSX get actual text extraction and/or visual
  inputs, not merely filename descriptions. Local extracted text supports
  follow-up inspection beyond the short prompt excerpt.
- Claude receives local paths and resumes its call session. Codex receives the
  call transcript, fresh reference context and up to four image inputs. Large
  prompts go through stdin to avoid Windows command-line length limits.
- Spoken turns are serialized while interrupted work unwinds. Context versions
  are acknowledged only after successful non-interrupted turns; upload bursts
  are coalesced instead of interrupting speech.
- Hangup aborts runtime work and file preparation, then removes call-owned
  temporary files. Participant access loss also ends the call.
- Bridge version becomes 0.32.0; package includes the compiled worker. Node
  minimum follows PDF.js: 20.16+ on 20.x, or 22.3+.

## Boundaries and safety

- 20 MB/file; four attachments/message; 40 preparations and 100 MB downloads/call.
- PDF text: up to 20 pages and 100,000 characters; visuals: first four pages.
  Images: PNG/JPEG/WebP up to 25 megapixels. Scanned pages outside the previews
  are not automatically inspected.
- DOCX: text only. XLSX: up to 10 sheets, 500 rows and 40 columns, existing values
  only. No macros/formulas/scripts are executed by extraction.
- Text extraction and long pasted messages are capped at 100,000 characters;
  recent call context is bounded, not a full archive.
- Link artifacts are references only; no automatic URL fetch. Audio/video,
  legacy Office and unsupported formats report their limitation.
- Document contents are labeled untrusted reference data, distinct from direct
  caller requests. This is not a replacement for runtime tool permissions or a
  security sandbox for the CLI. Restrictive runtime configurations must allow
  reads of the call's temporary files.
- Deletions update future context but cannot erase prior model knowledge or CLI
  session logs. Normal hangup cleans temporary files; a hard process crash can
  leave temporary files behind. Native parser memory is not fully bounded by
  the worker's JavaScript heap limit.

## Validation on Windows / Node 22.14.0

- `corepack pnpm build`: passed for shared, bridge, server and web. Vite needed
  an unsandboxed local rerun to resolve its configuration; no source workaround.
- `corepack pnpm --filter flow-agent-bridge test`: **266 passed, 7 skipped** in
  23 files. The seven skipped tests explicitly require `/bin/sh` and POSIX
  process groups; they remain enabled on POSIX and were not validated here.
- `corepack pnpm --filter @flow/web test`: **380 passed** in 44 files.
- Real worker fixtures cover PDF text/rendering, image loading, DOCX, XLSX,
  text, malformed/unsupported formats and limits. Call tests cover scoping,
  edits/deletes, reconnects, cancellation/cleanup, idle scheduling and both
  runtime context formats. Download tests cover actual streamed byte limits
  and access failures. A real Node subprocess verifies long stdin and image
  argument delivery, without invoking a paid model.
- `npm pack --dry-run --ignore-scripts --json`: passed; compiled context,
  scheduler and reader worker are included. Nothing was published.
- `git diff --check`: passed.

Existing tooling warnings remain: Vitest/esbuild warns about ES2024, the local
nested pnpm executable warns about legacy configuration, and Vite reports a
large web bundle. These did not fail the checks.

Not claimed: real microphone-to-LiveKit-to-model-to-speaker validation,
real Claude/Codex document reasoning, server database integration tests, or
macOS/iOS compilation and device QA. The call integration tests use simulated
voice sessions/model responses; they prove data plumbing, not audible quality.

## Live acceptance before release

Use a dedicated test bot/DM and the locally built bridge with its existing CLI
login. This checklist is pending; do not use other people's DMs for testing.

1. Call the bot, unmute, and verify ordinary speech before sharing files.
2. Upload a PDF containing a known fact without a caption. Ask about that fact
   and a visible first-page detail. Verify spoken answers and no extra chat reply.
3. Share new text, PNG, DOCX, XLSX and a DM file artifact during the same call.
   Ask about each; verify continuity, preparation follow-ups and interruption.
4. Edit/delete/replace material; briefly reconnect the bridge socket. Verify
   the latest version is used and old requests are not executed again.
5. Test unsupported, inaccessible and oversized files. Verify honest spoken
   limitations, not a fabricated summary. Share an unrelated-channel file and
   verify it never appears in the call context.
6. Hang up during preparation and during a runtime turn. Verify cancellation
   and temporary-file cleanup. Repeat with Claude and Codex and on each client.

## Visible impact

- [x] web client — shared DM material affects the bot's audible responses; no UI changes.
- [x] macOS client — same expected bridge-side behavior; native QA pending.
- [x] iOS client — same expected bridge-side behavior; native QA pending.
- [x] agent bridge — live shared-material ingestion, preparation and runtime input.

No database migration, client protocol change or native version bump. No images
or private conversations are included in this draft. New extraction libraries
are PDF.js (Apache-2.0), Mammoth (BSD-2-Clause), ExcelJS and napi-rs canvas
(MIT); JSZip (MIT or GPL-3.0-or-later) is used only for synthetic test fixtures.
