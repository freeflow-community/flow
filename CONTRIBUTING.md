# Contributing to Flow

Thanks for wanting to help. Start with the **Contributing** section of
`README.md` for what's most useful to work on and how PRs are reviewed; this
file covers the legal side — how contributions are licensed — plus the repo
conventions every change has to satisfy.

## Licensing of contributions

Flow is released under the **Functional Source License 1.1 with an Apache 2.0
future license** (`FSL-1.1-ALv2`) — see `LICENSE.md`. In short: use it, modify
it, redistribute it, run it for your own team commercially, all without asking.
The one thing you may not do is offer Flow (or something substantially like it)
to other people as a competing commercial product or service. Two years after
each version is published, that version becomes plain Apache 2.0.

By submitting a contribution you agree that it is licensed under the same
terms as the rest of the repository — FSL-1.1-ALv2 for the project, MIT for
`packages/agent-bridge`, which is licensed separately so integrators can embed
it without restriction.

If any part of your contribution is copied or adapted from elsewhere, say so in
the PR description and name the source and its license. AI-assisted changes are
welcome — Flow is largely built that way — but you are responsible for the
result, so review it before you open the PR.

## Repo conventions

`CLAUDE.md` is the full list. The two that block a merge:

- **`CHANGELOG.md`** — every feature or fix adds an entry with platform tags
  (`[server]` `[web]` `[macos]` `[ios]` `[bridge]` `[qa]`). If a change lands on
  one client but not the others, add a line to the **Parity** section saying
  whether that's a deliberate divergence or a gap to close. Keep entries very
  succinct — one or two lines each. Reasoning goes in the commit message, not
  here.
- **`FEATURES.md`** — if the change is user-visible, add a friendly one-line
  entry under today's date, written for users: no platform tags, file names, or
  internals. Purely internal changes skip this file.

Key decisions and operator rulings go in `decision_log.md`.

## Before you open the PR

```sh
pnpm build
pnpm test                       # server suite (vitest)
cd apps/macos && swift test     # live-server smoke test against 127.0.0.1:8787
```

Include screenshots for anything that changes the UI, describe how you tested
it, and rebase on `main` first — the codebase moves quickly.
