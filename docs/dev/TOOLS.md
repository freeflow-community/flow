# Local dev tools

Five commands that replace the setup work every recent change to this repo did
by hand: bringing a server and fixtures up, checking both native clients
compile, putting a push in front of a simulator, running the live API tests
somewhere other than 8787, and starting a changelog entry.

| | |
|---|---|
| `pnpm qa:up` / `pnpm qa:down` | throwaway server + database + fixtures + pre-auth |
| `scripts/check-clients.sh` | compile macOS **and** iOS before pushing |
| `scripts/push-sim.sh` | fire a real-shaped push at a booted simulator |
| `scripts/new-changelog.sh` | scaffold this PR's `changelog/` entry |
| `FLOW_TEST_SERVER_URL` | point macOS `LiveAPITests` at a server that isn't 8787 |

Every one of them takes `--help`.

---

## `pnpm qa:up` / `pnpm qa:down`

```sh
pnpm qa:up                      # start (or print the stack that's already up)
pnpm qa:up --fresh              # replace the current stack
pnpm qa:up --sim                # …and boot an iOS simulator
pnpm qa:up --json               # machine-readable summary on stdout
pnpm qa:down                    # remove exactly what qa:up created
```

`qa:up` picks a free port, creates its own Postgres database
(`flow_qa_<port>`), starts a server on it, seeds the standard fixtures via
`packages/server/scripts/qa-seed.mjs` (Alice / Bob / Scott in the **QA Lab**
workspace, password `qa-password-1`), and prints everything a run needs: URLs,
accounts, tokens, the server log, and a copy-pasteable line for each client.

**Signing in without driving the auth screen.** Two handoffs the product
already ships, so nothing here is a test-only backdoor:

- **native** — `open "flow://signin?code=…"`, the one-time code the web-to-app
  exchange uses (`POST /v1/auth/app-link`).
- **web** — `http://127.0.0.1:<port>/?signin=…`, the passwordless email link,
  lifted out of the dev mail outbox.

The web link lands signed in but on *Choose a Workspace*, because the client
only auto-selects a workspace it has been in before. `qa:up` also prints a
browser-console one-liner that sets `flow.token` and `flow.activeWorkspace`
and reloads, which skips both screens.

**What it does and doesn't own.** Postgres and NATS are borrowed — `qa:up`
checks they're reachable and tells you the `docker compose` line if they're
not, but never starts or stops them; a QA stack that killed the shared database
would take every other stack with it. Everything it *does* create is recorded
in `.qa/stack.json`, and `qa:down` removes that list and nothing else: it
refuses port 8787 outright (an unrelated app owns it on the build Mac), leaves
a pid alone if it no longer looks like the server it started, only drops a
database whose name it minted, and only shuts down a simulator it booted
itself.

Per-stack scratch state — the sealed data key, the email outbox, the push
outbox, uploaded files — lives under `.qa/run-<port>/`, so a QA run never
writes into the shared dev directories.

## `scripts/check-clients.sh`

```sh
scripts/check-clients.sh          # compile both clients, in parallel
scripts/check-clients.sh --tests  # …and run both hermetic test suites
scripts/check-clients.sh --macos  # one platform only
scripts/check-clients.sh --ios
```

macOS and iOS share the data model, networking, GRDB cache, `SyncEngine` and
`AppState`; the platform halves (`Banners`, `ImageLoader`, every View) are
separate files with matching signatures. When one of those signatures drifts,
the only thing that notices is the *other* platform's compiler. PR #465 is the
case: shared `SyncEngine` gained a `sound:` argument, the iOS `Banners` shim
didn't grow the parameter, macOS stayed green, and a 6.5-minute CI run was the
first thing to say so. Reintroduce that break and this script reports

```
  ✓ macOS
  ✗ iOS
      …/Sync/SyncEngine.swift:2077:53: error: extra argument 'sound' in call
```

in **3 seconds**. The first run in a fresh worktree pays for resolving and
compiling the SPM dependencies (about a minute); after that it's incremental.

## `scripts/push-sim.sh`

```sh
scripts/push-sim.sh                            # channel message, app in foreground
scripts/push-sim.sh --event dm --state cold
scripts/push-sim.sh --event reaction --state background
scripts/push-sim.sh --outbox                   # replay the newest real drain push
scripts/push-sim.sh --matrix --event thread    # foreground, background, cold in turn
```

Events: `message`, `mention`, `dm`, `group-dm`, `thread`, `reaction`, `added`,
`badge` (the silent badge-sync push). States: `foreground`, `background`,
`cold`.

The payload is never invented. `--outbox` replays the literal bytes the
server's dev push driver wrote to `.push/`, and everything else is built by
`packages/server/scripts/push-payload.ts`, which calls the drain's own
`buildPushPayload()` — so a push test can't end up testing a fixture that has
drifted from the sender. When a `qa:up` stack is running, the routing keys come
from its fixtures and the app is launched with `SIMCTL_CHILD_FLOW_SERVER_URL`
pointing at it, so a tap lands on a row that exists.

`--state background` drives the Simulator's Home with `osascript` — the one
step `simctl` has no verb for. Without Accessibility permission it says so and
fails rather than quietly running a foreground test.

Install the app first, e.g. after `scripts/check-clients.sh`:

```sh
xcrun simctl install booted apps/ios/.build/Build/Products/Debug-iphonesimulator/Flow.app
```

## macOS `LiveAPITests` and `FLOW_TEST_SERVER_URL`

`apps/macos/Tests/FlowTests/LiveAPITests.swift` talks to a real server. It
reads `FLOW_TEST_SERVER_URL`, then the app's own `FLOW_SERVER_URL`, and
defaults to `http://127.0.0.1:8787` as before:

```sh
cd apps/macos && FLOW_TEST_SERVER_URL=http://127.0.0.1:56067 swift test
```

When nothing Flow-shaped answers there, the tests **skip** with a message
instead of failing — the probe insists on Flow's own 401, so an unrelated
server squatting the port is "absent" too. That was worth fixing: on the build
Mac another app holds 8787 and answered every run with a 404, which failed
`swift test` in three consecutive PRs (#455, #459) for reasons that had nothing
to do with the code. CI runs `swift test --skip LiveAPITests`, so it never saw
it.

## `scripts/new-changelog.sh`

```sh
scripts/new-changelog.sh 465 "iOS Banners shim keeps the sound argument"
scripts/new-changelog.sh --feature 430 "Directory grid"     # user-visible change
scripts/new-changelog.sh --print dev-tooling "…"            # stdout, no file
```

Writes `changelog/YYYY-MM-DD-<ref>-<slug>.md` with the platform-tag bullets,
the optional `## Feature` section, and the PR's client-impact checklist in a
comment ready to paste. Refuses to overwrite an existing entry without
`--force` — one file per PR is what keeps concurrent PRs conflict-free.
