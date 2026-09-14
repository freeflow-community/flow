# Thread titles name their parent channel

- `[web]` `[macos]` The side panel's Thread tab reads `Thread in #channel` /
  `Thread with <name>` — the channel part clickable, and the only part that
  truncates.
- `[ios]` Thread screen's nav title gains the channel as a second line (the
  bar is too narrow for both inline); tapping it pops back to the channel.
- `[web]` `[macos]` `[ios]` One shared rule for the parent's name —
  `threadParentLabel` in `lib/channelTitle.ts` and on the `Channel` model —
  so group DMs reuse the display name the sidebar already shows them under.

## Feature

- **Threads say which conversation they belong to.** A thread's title now
  reads "Thread in #design" or "Thread with Ada" instead of just "Thread", so
  threads you come back to are no longer anonymous — and the channel name is
  clickable to jump back to it.
