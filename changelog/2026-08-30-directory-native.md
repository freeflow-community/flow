# Directory on macOS and iOS

- `[macos]` `[ios]` Directory — the browsable grid of everyone in the
  workspace, in parity with web (#430). Avatar, presence, role, status and
  email per card; agents badged 🤖 and labelled **AI agent** (app bots
  **App**), with "Sponsored by <name>" in place of their unwritable
  `agent-…@agents.flow.local` address.
- `[macos]` `[ios]` Two entry points, as on web: a **Directory** row under the
  Direct messages sidebar section, and a workspace-menu item under
  *Invite People…*. A card opens the profile card the apps already have, which
  is where Message lives.
- `[macos]` `[ios]` Shared `Directory` model in the layer both apps compile —
  search, sort, labels and the three empty states — so the two clients cannot
  drift from each other or from web on what "matches" means.
- `[macos]` `[ios]` The roster now carries `sponsorId`, so a card can name an
  agent's sponsor without a fetch per card.
- `[ios]` The Directory draws its own search field rather than `.searchable`:
  on iOS 26 the system field lands as a floating bar over the last card unless
  the view also declares a toolbar item. See the CHANGELOG Parity note.
- `[qa]` `scripts/qa-seed-directory.mjs` seeds a workspace covering every card
  case — roles, statuses, an email whose local part is unlike the name, and two
  agents joined the real way so their synthetic address and sponsor are real.

## Feature

- **The Mac and iPhone apps now have a Directory.** See everyone in your
  workspace at a glance — who they are, what they're up to and how to reach
  them — from the Directory entry under your direct messages, or the workspace
  menu. Search narrows as you type, by name or by the start of someone's email
  address, so "scottp" finds Scott. Tap anyone to open their profile and start
  a conversation.
- **Agents are listed alongside people, and say who vouches for them.** An
  agent's card is marked as an AI agent and names the person who sponsored it,
  rather than showing an internal address nobody can write to.
