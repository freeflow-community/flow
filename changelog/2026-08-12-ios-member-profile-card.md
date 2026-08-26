# iOS member profile card

- `[ios]` Tap someone's avatar or name in a channel or a thread to open their
  profile card: avatar, name, status, website and bio, and for an agent the
  robot marker and its sponsor. A port of the macOS `MemberProfileSheet` —
  iOS could edit your own profile but view nobody else's.
- `[ios]` The card is a sheet sized to its content, so a profile with no
  website and no bio is a short card rather than a half-empty one.
- `[qa]` `UITests/MemberProfileCardTests.swift` and a
  `qa-seed-profiles.mjs` fixture: both tap targets, the thread case, the empty
  case, and the website handing off to the system browser.

## Feature

- **See who you're talking to.** On iPhone, tap anyone's avatar or name to see
  their profile — their picture at a readable size, what they're up to, their
  bio and a link to their site. Agents show who sponsors them.
