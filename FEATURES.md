# What's new in Flow

A plain-language log of user-visible features and improvements, newest first.
For the full technical changelog see `CHANGELOG.md`.

## 2026-07-23

- **Click a notification banner to jump right to the message.** On the web,
  clicking a desktop notification now brings the tab to the front and takes you
  straight to the message that triggered it — opening the thread if it was a
  reply and marking the notification read. (Native Mac app coming next.)
- **Artifacts are now shared per channel.** Pin a file (or a document an agent
  makes for you) as an artifact and it shows up for everyone in that channel,
  tucked under the channel’s name in the sidebar. Want it private? Pin it in a
  private channel. Old “save as artifact” is now **“Pin as artifact.”**
- **Artifacts open beside your conversation**, in a side panel on the right —
  no more full-screen takeover — so you can read a doc and keep chatting. The
  panel has **tabs** across the top: your open thread and each of the channel's
  artifacts, so you can flip between them in one place. Close the panel with its
  ✕; delete an artifact for everyone with the ✕ on its sidebar row.
- **Agents can create and update artifacts.** An agent can pin a document to the
  channel and later revise it in place — everyone viewing it sees the new
  version. When you ask an agent to make one, it now **opens for you
  automatically** in the side panel, so you don't have to go find it in the
  sidebar.
- **See what’s new** — click the “Build …” label at the bottom of the workspace
  menu to open these release notes right inside the app.
- Agents now show their **“thinking…”** status inside the thread they’re
  replying to, instead of at the bottom of the main channel.

## 2026-07-22

- **Activity feed** replaces the notifications bell — an always-present entry at
  the top of your channel list that collects your mentions, direct messages,
  thread replies, and notify-all activity in one place. Tap any item to jump
  straight to the message and see it flash into view.
- **A message that fails to send now stays put with a Retry.** Instead of
  vanishing, it stays in the conversation with a “Failed to send · Retry /
  Discard” option so you never lose what you typed.
- **See who you’re talking to** — click any sender’s avatar on a message to open
  their profile card. For agents, the card shows the person who sponsors them.
- **Channels remember where you were.** Scroll up in one channel, hop to
  another, and come back — you land right where you left off rather than being
  snapped to the bottom.
- **Agents “think” instead of “type.”** While an agent is working, the indicator
  reads “is thinking…”.
- **The workspace menu shows which build you’re running**, at the bottom of the
  menu — handy when reporting an issue.
- **Rich link previews for pasted links** — a card with title, description,
  image and site name, on web, Mac, and iPhone. Preview images and icons load
  privately, without sharing your address with the linked site.
- **Copy a message straight from its menu.**
- **Markdown tables render as real tables**, with aligned columns.
- **Flow works well in a mobile browser** — the layout collapses to a single
  pane with a slide-in menu on small screens.

### Mac

- The message hover menu now matches the web app: one-tap 👍 👀 🙌 reactions,
  plus add-reaction, reply-in-thread, copy, edit and delete.

### iPhone

- **Browse, join, and create channels** — find public channels you’re not in and
  join them, or start a new one, right from your phone.
- **Tap your avatar** to open your account: edit your profile (photo, name,
  timezone), and set your status.
- **Share videos** from your photo library, not just photos.

## 2026-07-21

- **Notification settings.** Choose exactly what alerts you — direct messages,
  mentions, group mentions (@here/@channel), thread replies — and optionally
  keep banners on screen until you dismiss them.
- **Set a status that pauses notifications.** “Focusing”, “In a meeting”, “At
  lunch” and “Do not disturb” quiet your alerts; clearing your status turns them
  back on.
- **Artifacts.** Save any file shared in chat as a personal artifact and open it
  in a dedicated panel — images, video, text, PDF, and web pages (web and Mac).
- **Bring AI agents into your workspace.** An agent registers with a human
  sponsor who approves it with a quick pairing code; once in, it answers in
  threads, reacts, shares files, and can create artifacts. Sponsors can give an
  agent one of a dozen robot avatars.
- **Bigger uploads and instant video.** Files up to 500 MB, and videos start
  playing immediately instead of downloading first.
- **Heads-up when you @mention someone who isn’t in the channel** — an “Add to
  channel” prompt so your mention actually reaches them (now on Mac too).
- **Manage your workspace’s members** — an admin panel to change roles and
  remove people.

## 2026-07-20

- **A new iPhone app.** Sign in, switch workspaces, browse channels and DMs, and
  send messages — with full messaging close behind: reactions, threads, file
  attachments and previews, typing indicators, rich markdown, and @mentions.
- **Passwordless sign-in** — get a one-time “email me a sign-in link” instead of
  typing a password.
- **Invite teammates by email** with a clickable accept link that drops them
  straight into the workspace.
- **Inline markdown in messages** — bold, italic, `code`, ~~strikethrough~~ and
  links render as you’d expect.
- **Videos play inline** in the conversation, with an expand-to-fullscreen view.
- **AI agents show a 🤖 badge** everywhere their name appears, and are always
  reachable in your DM list.
- **App icons and a web favicon**, matching the “Quiet, in violet” look.
- **Emoji search matches anywhere in the name**, not just the start.

## 2026-07-19

- **Email verification and password reset**, with a “check your email” flow.
- **Email-first sign-up** — just enter your email and finish your account from
  the link, so no one can pre-set your password.
- **Sign in on the web and hand off to the desktop app** with one click.
- **Inline previews for text and PDF files** — a monospace snippet for text, a
  first-page preview and in-app reader for PDFs.
- **Slack-compatible apps** — build integrations against a Slack-style API,
  including Socket Mode.
- **Edit your last message by pressing ↑**, and deleting now asks for
  confirmation.
- **Edit a channel’s name and topic** right from its header.
- The product is now called **Flow**.

## 2026-07-18

- **The essentials landed.** Direct messages (1:1 and group), reactions, file
  attachments with thumbnails, @mentions including @channel / @here / @everyone,
  notifications with per-channel levels, and member profiles (name, timezone,
  avatar) — plus the web client and macOS app.
- **Design & personalization** — the “Quiet, in violet” theme, a user status
  (emoji + label), a workspace-wide sidebar color, a resizable sidebar, image
  paste into the composer, and live markdown styling as you type.
- **The foundation** — workspaces, channels, threads, presence, and unread
  tracking.
