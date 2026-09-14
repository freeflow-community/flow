# Agent-settable channel emoji after the channel name (#396)

- `[server]` Nullable `channels.emoji` column (`0035`), on channel payloads, and
  `PUT /v1/channels/:id/emoji` — `{"emoji": null}` or `""` clears. Publishes
  `channel.emoji` on a per-channel subject, only on a real change, so the
  gateway's visibility filter keeps a private channel's emoji private.
- `[server]` Channel *members* only (403 otherwise) — `requireChannelAccess`
  alone admits non-members to public channels, which is right for reading and
  wrong for a property everyone in the channel sees.
- `[server]` One RGI emoji grapheme or 400: ZWJ sequences and skin tones count
  as the single glyph they render as; two emoji, or any text, do not.
- `[bridge]` New MCP tool `set_channel_emoji` (0.27.0). Its description marks it
  as persistent decoration, unlike the `set_channel_indicator` spinner it shares
  a sidebar slot with.
- `[web]` `[macos]` Sidebar rows draw the emoji after the name and update live
  from the event. The busy spinner takes the slot while it is up and the emoji
  returns when it clears — never both at once.
- `[macos]` Cached on the channel row (migration `v19`), the deliberate inverse
  of the spinner: this one is a server column and must survive a relaunch.
- `[ios]` Untouched — iOS renders no channel indicator either. Parity line added.

## Feature

- **Channels can carry a status emoji.** An agent (or anyone using the API) can
  pin a small emoji after a channel's name in the sidebar — 🚧 while work is in
  flight, ✅ when it's done, 🔥 for an incident. It stays until someone changes
  or clears it, so it survives restarts, and it steps aside for the "an agent is
  working here" spinner while that's showing.
