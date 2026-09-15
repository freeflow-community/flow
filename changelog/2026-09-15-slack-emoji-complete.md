# Every Slack emoji name, and custom emoji in message text

- [server] Slack connector knows every standard Slack emoji name (1,972, from iamcal's `emoji-datasource`, checked in as `src/slack-emoji.json` with `scripts/build-slack-emoji.mjs`); shared table wins where both name one. Skin tones apply only to emoji that take them.
- [web] Custom emoji (Flow and Slack) draw inline in message text, not only in reactions.
- [qa] slack-connector emoji test; `format.test.tsx` custom emoji in text.

## Feature

- **All Slack emoji show up.** Emoji like 💕 and 🫶 in Slack messages now appear as emoji instead of their `:name:`.
- **Custom emoji in messages.** On the web, your workspace's custom emoji now appear inside message text, not only as reactions.
