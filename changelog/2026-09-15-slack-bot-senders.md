# Slack app messages show the app's name

- [server] Slack connector turns the app behind a bot message (`bot_profile` name and icon, or a webhook's username) into a member row keyed by its `B…` id: listed by `/v1/members` and streamed as `member.updated` when first seen.
- [web] `member.updated` adds a sender the roster has not seen yet (was replace-only). macOS and iOS already upsert.
- [qa] slack-connector bot sender test.

## Feature

- **Slack apps are named.** Messages posted by Slack apps and integrations, like alert bots, show the app's name and icon instead of "Unknown".
