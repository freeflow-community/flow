# Slack channels: mention names, emoji, A–Z channel list

- [web] [macos] [ios] `<@U…>` Slack user mentions render as name pills; the mention pattern only accepted Flow UUIDs, so Slack bodies showed the raw id.
- [server] Slack connector expands `:shortcode:` emoji (and `::skin-tone-N` modifiers) in message text to unicode, outside code; custom workspace emoji stay as text.
- [web] Sidebar sorts joined channels by name itself; Slack returns its own order. Native sidebars already sort in their local query.
- [qa] `format.test.tsx`, `Sidebar.test.tsx`, `MentionRenderingTests.swift`, and `slack-connector` baseline tests.

## Feature

- **Slack channels read the way they do in Slack.** Mentions show the person's name instead of a code like `<@U08JDGF1EAY>`, and emoji like `:tada:` show as 🎉. Custom emoji from your Slack workspace still show as their name.
- **Slack channels are listed A to Z** in the sidebar on the web.
