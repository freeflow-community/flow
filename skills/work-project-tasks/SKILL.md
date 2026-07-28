---
name: work-project-tasks
description: >
  Pull the next unit of work off the Flow team's GitHub Project queue and take it
  all the way to a pull request. Use when asked to "work on the next task from the
  active queue", "work on the next batch", "take the next queued task", "what's
  next in the queue", or "pick up the next Project task". Covers finding the next
  queued batch, claiming it, building it in an isolated worktree, verifying it with
  screenshots, opening a PR that closes every issue in the batch, and marking the
  Project items Done.
---

# Working tasks from the Project queue

Work is queued on the GitHub Project **"Flow work queue"**
(`freeflow-community` project **#1**), not in the issue list. The board at
`github.com/orgs/freeflow-community/projects/1` is the source of truth for
*what to do next*; issues are the source of truth for *what the task is*.

Invoking this skill means: **take the next batch off the queue and finish it.**
One batch → one worktree → one branch → one PR.

## The queue model

Every project item has a **Status** and an optional **Batch**.

| Status | Meaning |
|---|---|
| `Todo` | In the backlog. Not yours to take. |
| `Queued for Dev` | Staged by a human. **This is what you pick up.** |
| `In Progress` | Claimed — someone (probably you) is working it. |
| `Done` | Landed. |

**Batch** is a number field. Items sharing a batch number are **one unit of
work**: one branch, one PR closing all of them. An item with no batch is a batch
of one. Never take half a batch, and never merge two batches into one PR.

Queue order is the project's own item order — the topmost `Queued for Dev` item
is next.

You need `gh` authenticated with the `project` scope:

```sh
gh auth status          # want: Token scopes include 'project'
```

---

## 1. Find the next batch

```sh
bash skills/work-project-tasks/next-batch.sh
```

It prints a JSON array of the batch members (`itemId`, `number`, `title`,
`repo`, `body`, `status`, `batch`), or the string `IDLE`.

**If it prints `IDLE`, stop.** Nothing is queued. Say so and do not go looking
for work in the backlog — `Todo` items are deliberately not yours to start.

Read every member's `body` before planning. A batch is grouped because the
issues are related; the shape of the fix usually only makes sense across all of
them.

## 2. Claim the batch

Set every member to `In Progress` **before** you start, so a second agent
doesn't take the same work:

```sh
bash skills/work-project-tasks/set-status.sh "In Progress" <itemId> [<itemId> ...]
```

Claim the **whole batch in one go**. `next-batch.sh` only lists members that are
still `Queued for Dev`, so claiming them one at a time leaves the rest looking
available — and the next agent along will take half your batch.

## 3. Branch in a fresh worktree

Never build in the main checkout — it may be mid-edit, and other worktrees exist.

```sh
git -C "$(git rev-parse --show-toplevel)" fetch origin
git worktree add -b fix/issue-<n>-<slug> ../flow-wt-<slug> origin/main
cd ../flow-wt-<slug>
pnpm install
```

Branch off **`origin/main`**, never off whatever is checked out. Name the branch
after the lowest issue number in the batch.

## 4. Build it

Read `CLAUDE.md` first — it is the working-conventions contract and several of
its rules block a merge. The ones that bite most often:

- **`CHANGELOG.md` gets an entry** with platform tags (`[server]` `[web]`
  `[macos]` `[ios]` `[bridge]` `[qa]`). One or two lines. A change that lands on
  one client but not another **must** add a Parity line.
- **`FEATURES.md` gets a friendly one-liner** if the change is user-visible.
  Skip it for refactors, tests and infra.
- **Bump `apps/macos/VERSION` in any PR touching `apps/macos/**`**, including
  the shared Swift core iOS reuses.

Run the local stack when you need it:

```sh
docker compose -f packages/infra/docker-compose.yml up -d   # postgres on 5442
pnpm dev                                                    # 127.0.0.1:8787
```

> The dev server binds **127.0.0.1:8787**. If something else already holds that
> port, stop it or set `PORT` — don't assume the page you're looking at is Flow.

## 5. Test, then verify for real

```sh
pnpm test          # whole workspace
pnpm -r build      # typecheck everything that ships
```

Green tests are necessary, not sufficient. **Look at the change in the running
app** and capture screenshots for the PR.

**Safety gate — this is not optional.** UI automation drives the human's actual
desktop. Per `CLAUDE.md` and the QA manual in
`.claude/agents/quality-assurance.md`, browser and macOS UI automation requires
an **idle desktop or explicit operator authorization**. If you have not been
given it in this session, **ask before driving the UI**, and if the answer
doesn't come, open the PR without screenshots and say why. Never quietly take
over the screen.

Once cleared:

- **Web** — drive Chrome via the browser MCP tools (load them with ToolSearch
  first; `claude-in-chrome` needs site permission for `127.0.0.1`).
- **macOS** — build with `apps/macos/tools/make-app.sh`, then
  `screencapture -x -R"$X,$Y,$W,$H" /tmp/shot.png` and `Read` the file.

Prefer the accessibility tree for asserting *state* — it's cheaper and more
precise than pixels. Screenshots are evidence of *appearance*, which is what
the PR wants.

## 6. Commit, push, open the PR

`CONTRIBUTING.md` asks every commit to be **signed off** (DCO), so use `-s`:

```sh
git commit -s -m "fix(web): ..."
```

Sign-off is a provenance claim — it says a person vouches for this change. If
you are an agent committing under a bot identity, sign off under the human who
asked for the work, or leave it to them at merge time; don't certify on their
behalf without being told to. (In practice `main` is a mix of both.)

Push and open one PR for the whole batch, closing every issue in it:

```sh
git push -u origin fix/issue-<n>-<slug>
gh pr create --base main --title "..." --body "$(cat <<'EOF'
<what changed and why — the reasoning belongs here, not in CHANGELOG.md>

Closes #81
Closes #110
Closes #111

## Verification
<screenshots, and what you asserted>
EOF
)"
```

Attach screenshots by uploading them to the PR body (drag-and-drop equivalent:
`gh pr comment` with an image URL, or push them to a branch and link). One
`Closes #n` line **per issue in the batch** — that is what makes merging the PR
close all of them.

## 7. Mark the batch Done

Only after the PR is open (and merged, if you were asked to merge):

```sh
bash skills/work-project-tasks/set-status.sh Done <itemId> [<itemId> ...]
```

Then report: the PR URL, the issues it closes, what you verified, and anything
you deliberately left out.

---

## If you can't finish

**Put the work back.** An item stuck in `In Progress` with nobody on it is worse
than one in the queue — the board says it's being handled and it isn't.

```sh
bash skills/work-project-tasks/set-status.sh "Queued for Dev" <itemId> ...
```

Say what blocked you. If the task is underspecified, comment on the issue with
the specific question rather than guessing — a wrong guess costs more than a
round trip.

## Rules worth restating

- **Don't start `Todo` work.** If the queue is empty, the answer is "nothing is
  queued", not "here's something from the backlog I picked".
- **Don't split or merge batches.** The grouping is a human decision about what
  belongs in one review.
- **Don't mark Done without a PR.** Done means the change exists and is
  reviewable, not that you finished editing.
- **Don't push to `main`.** Everything goes through a PR.
