# UI Nits

These are relatively small UI improvements requested for the clients. As these are completed
we should check these off here:

- The thread panel should have a drop shadow so it feels like it sits _over_ the main chat.
status: done [web] [macos] — subtle leading-edge shadow (ink-tinted) on the panel on both clients.
- On first login to a channel, the chat should scroll all the way to the bottom
status: done [web] [macos] — web stays pinned to the bottom while late-loading attachments grow the list; macOS anchors the scroll view at the bottom (`defaultScrollAnchor`) instead of a pre-layout `scrollTo`.
- "Person is typing..." message is staying after a message is sent and received
status: done [web] [macos] — both clients now clear the sender's typing entry when their message arrives; web also gained the 5s expiry sweep it was missing (macOS already had one).
