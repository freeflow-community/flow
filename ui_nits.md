# UI Nits

These are relatively small UI improvements requested for the clients. As these are completed
we should check these off here:

- The thread panel should have a drop shadow so it feels like it sits _over_ the main chat.
status: done [web] [macos] — subtle leading-edge shadow (ink-tinted) on the panel on both clients.
- On first login to a channel, the chat should scroll all the way to the bottom
status: done [web] [macos] — web stays pinned to the bottom while late-loading attachments grow the list; macOS anchors the scroll view at the bottom (`defaultScrollAnchor`) instead of a pre-layout `scrollTo`.
- "Person is typing..." message is staying after a message is sent and received
status: done [web] [macos] — both clients now clear the sender's typing entry when their message arrives; web also gained the 5s expiry sweep it was missing (macOS already had one).

- Shared image preview should be larger in chat - like 2x as large.
status: done [web] [macos] — web cap 288×240 → 576×480 CSS px, macOS fit box 280×240 → 560×480. Note: server thumbs stay at 512px max, so the largest previews render soft on retina (thumb pipeline untouched — regenerating existing files was out of scope).
- The message hover menu (with emoji and reply in thread) is good on web - should be ported to native mac
status: done [macos] — hover overlay card (white pill, hairline border, design-3a tokens) with react + reply-in-thread; the react button stays mounted while its picker popover is open (existing anchor rule).
- Message hover menu should include delete (with connfirm), and edit message
status: done [web] [macos] — web already had edit/delete buttons, delete now confirms via a small modal; macOS hover menu (and context menu) gained Edit + Delete with an AX-accessible confirmationDialog.
- Need to implement "up arrow to edit last message" (as long as no other messages have arrived).
status: done [web] [macos] — ↑ in an empty composer edits your message only when it's the newest in the channel/thread (Slack semantics); Esc cancels (web inline editor, macOS edit sheet).
- clicking on channel name should show popup to: edit channel name, and channel topic (shown as a sub headline)
status: done [server] [web] [macos] — topic column existed since 0000_init (no migration); added PATCH /v1/channels/:id (any channel member; #general keeps its name) + channel.updated WS fan-out; both clients open a name/topic editor from the header name and already rendered the topic sub-headline.

- Emoji search should do substring match in the emoji name, not just prefix
