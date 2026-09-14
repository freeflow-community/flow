# Blank transcript on channel open, fixed at the root

- `[ios]` `[macos]` Short transcripts (≤100 messages) now render eagerly:
  LazyVStack's row-height estimates ran ~2x off in short channels of tall
  messages, parking the viewport over phantom space — a blank screen that
  hit about half of channel opens. Every fresh open loads one ~50-message
  page, so eager covers all first paints; deep histories stay lazy.
- `[ios]` `[macos]` Correction scrolls are skipped when the transcript is
  already bottom-aligned: a no-op scrollTo forced a LazyVStack re-estimate,
  which resized the content, which triggered the next scroll — a permanent
  layout war that also burned CPU while a channel was open.

## Feature

- **Channels open reliably.** The transcript no longer comes up blank on
  open or when returning to a channel.
