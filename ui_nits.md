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
status: done [web] [macos] [ios] — shared emojiMatches (web :shortcode: composer autocomplete) and EmojiCatalog.matches (macOS composer autocomplete) now substring-match with prefix hits ranked first; the web/macOS/iOS picker grids (already substring) picked up the same prefix-first ranking. Unit tests on both sides.
- App tokens should be visible when managing apps. No need to hide those.
status: done [server] [web] — raw tokens now stored alongside their auth hashes (migration 0011; PM ruling pending operator review — see decision_log); GET /v1/apps/:id/credentials (owner/admin) backs a Credentials block in the Configure section (monospace + copy, creation-reveal styling). Pre-0011 apps show "created before token visibility — regenerate to view" with a confirm-guarded Regenerate (POST /v1/apps/:id/credentials/rotate).
- Instead of "Disable" apps we should just Delete them completely
status: done [server] [web] [macos] — Manage Apps gains Remove… (inline confirm): DELETE /v1/apps/:id removes the app + credentials, pulls the bot from the workspace/channels and member/mention lists, deletes 1:1 bot DMs; macOS refreshes members on workspace-level member.left. (Disable retained for temporary off-switching.)
- Hover over thread replies icon and count should change cursor to hand
status: done [web] [macos] — web: cursor-pointer on the replies pill (Tailwind v4 preflight leaves buttons on the default cursor); macOS: NSCursor.pointingHand push/pop onHover, same pattern as the panel resize handles.
- Add support for sharing video files, and playing with preview (and expand button) in the chat
status: done [server] [web] [macos] — GET /v1/files/:id now speaks HTTP Range (Accept-Ranges/206/416; unit-tested + curl-verified byte-for-byte) for seek-by-URL players; uploads already accepted video mimes. Web renders mp4/mov/webm inline (preview-card chrome: collapse chevron, hover Download + Expand; native <video> controls, lightbox overlay; undecodable codecs fall back to the chip). macOS renders mp4/mov/m4v via AVKit behind a play-button placeholder (downloads on first play; no server poster — ruled) with an expanded sheet matching the image lightbox; webm stays a chip (AVFoundation — Parity divergence). iOS still chips video into QuickLook — Parity gap.
- Add some common missing Slack emojis like :thread:
- The message context menu "stutters" when you hover over it, blinking in and out so you can't select it easily

