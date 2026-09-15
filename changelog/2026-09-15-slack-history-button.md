# Slack history limit on the load button

- [web] [macos] [ios] The separate "Slack allows this app one history page per minute…" banner is gone; "Load earlier messages" says the budget itself — "(15 max/min)", or "(wait 42s)" and disabled after a 429.
- [qa] Issue #545/#546 web acceptance scripts wait on the button label; macOS `loadOlderButtonSaysTheHistoryBudget`.

## Feature

- **Simpler history loading in Slack channels.** The "Load earlier messages" button now shows Slack's limit, or how long to wait, instead of a separate notice above the chat.
