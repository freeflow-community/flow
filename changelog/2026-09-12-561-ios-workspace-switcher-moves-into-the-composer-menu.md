# iOS: workspace switcher moves into the composer menu (#561)

- `[ios]` The floating "Workspaces and servers" capsule is gone from the
  bottom-right overlay — it sat exactly on the send button, so typing a message
  covered the control you were typing towards. The root still owns the switcher
  sheet; its trigger now travels down as an `openConnections` environment
  action (#561).
- `[ios]` The composer's `+` menu carries "Workspaces & servers", and is now
  always a menu: under provider gating a workspace with no files and no
  scheduling used to render a dead dimmed glyph, which would have hidden the
  switcher entirely. The "attachments unavailable" reason moved onto a disabled
  row inside it.
- `[ios]` The sign-in screen gets the same entry, since it has no composer to
  hold one — and its server line now names the live connection instead of the
  compiled-in default, which could name a server the app would not sign in to.

## Feature

- **The workspace and server switcher lives in the composer's + menu.** It used
  to float over the send button on iPhone, so a typed message was hard to send;
  now it is one tap from the composer, and the send button is always clear.
