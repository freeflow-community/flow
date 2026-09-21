# macOS/iOS: no pins error when opening a Slack channel

- [macos] [ios] Opening a Slack channel no longer calls Flow-only routes on the connector: pinned messages (which raised a "Couldn't load pinned messages: HTTP 404" alert), the channel roster and the archived-channel lookup are skipped for a provider workspace.
