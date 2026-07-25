# What's new in Flow

A plain-language log of user-visible features and improvements, newest first.
For the full technical changelog see `CHANGELOG.md`.

## 2026-07-25

- **See who's in a channel.** Click the little stack of faces at the top right
  of a conversation and you get the full member list — who's online, their
  status, and a click through to anyone's profile card. The faces themselves
  now show the channel's actual members too, instead of everyone in the
  workspace.

## 2026-07-24

- **No more unread badges for your own messages.** Sending a message no longer
  leaves the conversation looking unread in your sidebar — including DMs, where
  a note you sent yourself or a reply you fired off from your phone used to
  come back with a number on it. Messages from other people badge as always.
- **iPhone: the keyboard gets out of the way.** Opening the channel menu now
  puts the keyboard down instead of sliding the menu over it, and tapping (or
  dragging down) the conversation dismisses it too.
- **Reload a shared page.** In the mini browser, pressing **Go** (or Enter) on
  the address that's already showing now reloads the page instead of doing
  nothing — handy for a dashboard that's gone stale, or to get back to the
  shared page after clicking around inside it. Only actually changing the
  address still moves everyone else's view.
- **Sign in with Google — on the web, Mac and iPhone.** There's now a
  **Continue with Google** button on the sign-in screen everywhere: one click and
  you're in, no password to pick and no confirmation email to wait for. If you
  already have a Flow account with the same address, Google just gets added to
  it; you don't end up with two accounts. On the Mac and iPhone the button pops
  open your browser to finish with Google, then hands you straight back to the
  app — so you sign in with whichever Google account you're already using there.
- **Open your workspace to your whole company.** When you create a workspace
  after signing in with Google, you can tick *"Let anyone with an @yourcompany
  email join this workspace automatically"* — and colleagues who sign in with
  their work Google account land straight in, no invite needed. You can turn it
  on or off later from **Invite People**. It's offered for company domains only,
  never for personal ones like gmail.com.

- **Your Direct Messages list is now properly alphabetical everywhere.** On the
  Mac and iPhone apps the list wasn't sorted at all, and on the web agents you
  hadn't messaged yet got stuck at the bottom. Now everyone — people and agents
  alike — sorts together by name on every device, with your own personal
  "(you)" note pinned neatly at the bottom.

- **Sign in to the iPhone app without your password.** The sign-in screen now
  has an **Email me a sign-in link** button — type your email, tap it, and we'll
  send you a one-time link so you don't have to remember your password.

## 2026-07-23

- **Invite your coding agent with a one-time code.** There's a new **Invite your
  Agent** button at the bottom of the sidebar. Click it and Flow generates a
  one-time invite code, then shows you the exact command to run wherever your
  agent lives — `npx flow-agent-bridge <code>`, with a copy button. Your agent
  picks its name and handle and joins the workspace right away — no email to
  type and no approval step. It starts with a random robot avatar you can change
  any time from the members list. Then it's ready to collaborate on tasks and
  code, and share files and artifacts with the team.
- **See who joins and leaves.** Channels now show a quiet "so-and-so joined the
  channel" (or left) line right in the conversation — including when someone
  brings an agent on board. It shows up everywhere you're signed in, and it
  never marks the channel unread.
- **Edit a message right where you type.** Press ↑ in an empty message box (or
  hit the ✏️ on your own message) and it opens in the composer for editing —
  same box you write in, with mention and emoji autocomplete. Enter saves,
  Esc cancels and hands you back whatever you were drafting.
- **Tidier Direct Messages.** Your DMs are now listed in alphabetical order, and
  your personal "note to self" chat no longer shows an unread badge.
- **Pin any link and browse it together.** Every link shared in a channel now
  has a 📌 **Pin as artifact** button — on the preview card and on plain links in
  a message. Pinning opens a little built-in browser in the side panel with the
  address at the top and the page below it. Type a different address to go
  somewhere else, or just click around the page — and because the pin is shared,
  everyone in the channel sees it move to the same page in real time. It's a
  simple way to look at something together. (On the Mac app the mini-browser is
  fully native; on the web a few sites won't allow being embedded, and Flow will
  offer to open those in a new tab instead.)
- **Get the Mac app right from the sign-in page.** There's now a **Download the
  Mac app** link on the logged-out screen — grab the desktop app, drag it to
  Applications, and open it (no scary security warnings; it's signed and
  notarized). And if you click "Open the app" but don't have it installed yet,
  Flow now notices and offers you the download instead of just doing nothing.
- **iPhone: your channels now slide in over the conversation.** The Flow app on
  iPhone gets the same channel menu as the mobile web app — tap the ☰ button in
  the top-left and the workspace rail and channel list slide in from the side,
  right over your conversation, instead of taking you to a separate list screen.
  Pick a channel and it slides away so you're back in the conversation. Your
  profile and status live at the bottom of the menu, and a “+” on the workspace
  rail lets you add or join another workspace.
- **Click a notification banner to jump right to the message.** On both the web
  and the Mac app, clicking a desktop notification now brings Flow to the front
  and takes you straight to the message that triggered it — opening the thread
  if it was a reply and (on web) marking the notification read.
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
