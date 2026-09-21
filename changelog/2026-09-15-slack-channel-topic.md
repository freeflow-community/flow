# Slack channel topics read properly

- [server] Slack connector converts a channel topic from mrkdwn like a message body (links, mentions, `:emoji:`), instead of passing Slack's raw tokens through.
- [macos] The topic tooltip renders markdown as plain text — a link shows its label, a mention its name.
- [qa] `channelTopic` test; `TopicTooltipTests.testMarkdownTopicShowsItsLabel`.

## Feature

- **Readable channel topics.** A Slack channel's topic now shows real links and emoji, instead of text like `<mailto:support@biztrip.ai|support@biztrip.ai>`.
