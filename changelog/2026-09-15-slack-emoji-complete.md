# Every Slack emoji name; emoji in text sized like Slack

- [server] Slack connector knows every standard Slack emoji name (1,972, from iamcal's `emoji-datasource`, checked in as `src/slack-emoji.json` with `scripts/build-slack-emoji.mjs`); shared table wins where both name one. Skin tones apply only to emoji that take them.
- [web] Custom emoji (Flow and Slack) draw inline in message text, not only in reactions.
- [web] Emoji in message text draw at 1.4x the text size without changing line height (Parity: web only).
- [qa] slack-connector emoji test; `format.test.tsx` custom emoji in text.

## Feature

- **All Slack emoji show up.** Emoji like 💕 and 🫶 in Slack messages now appear as emoji instead of their `:name:`.
- **Custom emoji in messages.** On the web, your workspace's custom emoji now appear inside message text, not only as reactions.
- **Bigger emoji in messages.** On the web, emoji inside a message are a little larger than the text, as in Slack, so they are easier to see.
