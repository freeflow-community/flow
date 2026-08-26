# Web: Create Workspace derives the slug from the name

- `[web]` The Create Workspace form fills the slug in as you type the name, and
  stops deriving once you edit the slug yourself. Clearing the slug re-arms it.
- `[web]` Closes a parity gap: macOS and iOS have always done this, so the same
  name now gives the same slug on all three clients. `slugify` in
  `packages/web/src/lib/slugify.ts` is a port of the Swift rule — iterating
  graphemes, not code points, so decomposed text ("Café" as `e` + U+0301)
  slugifies the same everywhere.

## Feature

- **Creating a workspace on the web no longer makes you invent a slug.** Type
  the name and the URL-safe slug appears beside it; type over it if you want a
  different one and it will stay as you left it.
