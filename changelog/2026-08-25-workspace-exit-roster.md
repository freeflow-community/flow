# Delete workspace is no longer offered before we know who's in it

Fixes the follow-up shipped in the delete-empty-workspace entry, reported from
the iOS app: "I saw Delete work once, but it's mostly failing. No errors but it
fails to delete."

- `[web]` `[macos]` `[ios]` The Leave/Delete choice is one named rule
  (`WorkspaceExit.swift`, `lib/workspaceExit.ts`) instead of a predicate
  written out per client. `count <= 1` is true of an *empty* roster, so any
  workspace whose members hadn't loaded offered Delete regardless of who was in
  it and the server refused with 409. Delete now requires a roster that
  positively contains us; not knowing falls back to Leave.
- `[ios]` `RootView` renders `app.errorMessage`, a port of the macOS alert.
  `showError` always set it on iOS and nothing displayed it, so every failure
  on the phone was silent — which is why a refused delete looked like a no-op
  rather than a refusal.
- `[macos]` `[ios]` The roster is fetched as soon as a workspace is selected
  rather than behind channels and artifacts: a `Menu` snapshots its contents
  when it opens, so a late roster can't correct a menu already on screen.

## Feature

- **Fewer wrong menu items, and errors you can actually see.** *Delete
  workspace* now only appears once Flow knows who is in the workspace, so it
  won't offer to delete one that still has people in it. And when something
  fails on iPhone, you get told — failures used to be silent.
