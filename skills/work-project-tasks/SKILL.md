---
name: work-project-tasks
description: >
  Pull the next unit of work off the Flow team's GitHub Project queue and take it
  all the way to a pull request. Use when asked to "work on the next task from the
  active queue", "work on the next batch", "take the next queued task", "what's
  next in the queue", or "pick up the next Project task". Covers finding the next
  queued batch, claiming it, reporting progress in a Flow channel, building it in
  an isolated worktree, verifying it with screenshots, opening a PR that closes
  every issue in the batch, and marking the Project items Done.
---

# Working tasks from the Project queue

Work is queued on the GitHub Project **"Flow work queue"**
(`freeflow-community` project **#1**), not in the issue list. The board at
`github.com/orgs/freeflow-community/projects/1` is the source of truth for
*what to do next*; issues are the source of truth for *what the task is*.

Invoking this skill means: **take the next batch off the queue and finish it.**
One batch → one Flow channel → one worktree → one branch → one PR.

## The queue model

Every project item has a **Status** and an optional **Batch**.

| Status | Meaning |
|---|---|
| `Todo` | In the backlog. Not yours to take. |
| `Queued for Dev` | Staged by a human. **This is what you pick up.** |
| `In Progress` | Claimed — someone (probably you) is working it. |
| `Blocked` | Started, can't proceed. Needs a human. Not yours to retry. |
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

## 3. Open a Flow channel and report there

Work in the open. Create one channel per batch and use it as the running record,
so a human can see what you're doing and interrupt before you've gone too far.

Use the `flow` MCP tools (see the `flow-agent-member` skill for the full set):

- `create_channel` — `name` `task-<lowest issue number>`, e.g. `task-81`. Put the
  batch in the `topic`: `#81, #110, #111 — message hover polish`. Leave it
  **public** (`isPrivate` false) so anyone can follow without being added.
- `invite_to_channel` — add whoever asked you to run this, plus anyone already
  discussing the issues. Several `userIds` in one call; `list_users` gets the ids.
- `send_message` — the updates.
- `upload_file` — screenshots, as you take them.

**Announce it back where you were asked.** The person who invoked this skill is
in some other channel or DM and won't think to go looking for a channel you just
invented. As soon as it exists, post there:

> Working #81, #110, #111 (batch 1) — progress in #task-81.

Note the source conversation **before** you create the channel. The bridge points
the `flow` tools at the conversation you're replying to by default, so once the
new channel exists you need to be deliberate: pass the new `channelId` for task
updates, and the original one to reach the requester. Getting this backwards
means posting the running log into someone's DM.

Your final reply lands in the source conversation anyway, so that's where the
outcome goes — no need to repeat the whole log there.

Then post at the moments a human might want to intervene, not every command:

1. **On claim** — what you picked up, the issue numbers, and the approach in two
   or three lines. This is the cheapest possible moment to be told "no, not like
   that".
2. **On a surprise** — the issue was wrong, the fix is bigger than described, two
   issues in the batch conflict. Say so when you find it, not in the summary.
3. **Screenshots** — as evidence accumulates.
4. **On PR** — the link.
5. **At the end** — `Done` with the PR, or `Blocked` with the reason.

Keep it readable. A channel that narrates every file read is one nobody reads;
the test is whether someone skimming it later can tell what happened and why.

Cross-link both ways: put the channel in the PR body, and the PR link in the
channel.

**If the `flow` tools aren't available** — no bridge, no MCP server — carry on
without them and say so in your final report. Losing the progress channel is not
a reason to abandon the task.

## 4. Branch in a fresh worktree

Never build in the main checkout — it may be mid-edit, and other worktrees exist.

```sh
git -C "$(git rev-parse --show-toplevel)" fetch origin
git worktree add -b fix/issue-<n>-<slug> ../flow-wt-<slug> origin/main
cd ../flow-wt-<slug>
pnpm install
```

Branch off **`origin/main`**, never off whatever is checked out. Name the branch
after the lowest issue number in the batch.

## 5. Build it

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

## 6. Test, then verify for real

```sh
pnpm test          # whole workspace
pnpm -r build      # typecheck everything that ships
```

Green tests are necessary, not sufficient. **Look at the change in the running
app** and capture screenshots for the PR.

**You are authorized to drive the UI.** `CLAUDE.md` and the QA manual
(`.claude/agents/quality-assurance.md`) require an idle desktop or explicit
operator authorization for browser and macOS automation, because it normally
takes over a human's screen. Agents running this skill are on a **dedicated
machine**, which is that authorization standing — don't stop to ask.

The one condition: if you can tell you're *not* on a dedicated host — someone is
using the desktop, or you were started on a person's laptop — the original gate
applies again. Ask, and open the PR without screenshots if no answer comes.

So, screenshots:

- **Web** — drive Chrome via the browser MCP tools (load them with ToolSearch
  first; `claude-in-chrome` needs site permission for `127.0.0.1`).
- **macOS** — build with `apps/macos/tools/make-app.sh`, then
  `screencapture -x -R"$X,$Y,$W,$H" /tmp/shot.png` and `Read` the file.

Prefer the accessibility tree for asserting *state* — it's cheaper and more
precise than pixels. Screenshots are evidence of *appearance*, which is what
the PR wants.

### Put the machine back

Everything you started for the verification, stop when you're done. The next
agent inherits this machine, and so does the human whose desktop it is: a dev
server left holding a port sends the following run off to test against the
wrong build. Stop your server, quit the app builds you launched, terminate the
simulator app, and undo any system setting you flipped to make a check possible
(appearance, for instance).

```sh
pkill -f "flow-wt-<slug>/packages/server"          # your dev server
pkill -f "flow-wt-<slug>/apps/macos/dist/Flow.app" # your macOS build
xcrun simctl terminate booted org.flowtoo.app      # your simulator app
```

Match on your **own worktree path**, never a bare `pkill -f Flow` — other agents
run their own copies and the human may have the real app open. Check what a PID
actually is (`lsof -p <pid> | awk '$4=="cwd"'`) before killing anything you
can't attribute. Whatever was already running when you arrived — postgres, a
simulator someone else booted, whatever holds 8787 — is not yours to stop.

If you took a port other than 8787 because 8787 was busy, mention in the channel
that it's going away, so nobody is left poking at a server you just killed.

## 7. Commit, push, open the PR

Commit, then open one PR for the whole batch, closing every issue in it:

```sh
git push -u origin fix/issue-<n>-<slug>
gh pr create --base main --title "..." --body "$(cat <<'EOF'
<what changed and why — the reasoning belongs here, not in CHANGELOG.md>

Closes #81
Closes #110
Closes #111

Progress log: #task-81 in Flow.

## Verification
<screenshots, and what you asserted>
EOF
)"
```

Attach screenshots by uploading them to the PR body (drag-and-drop equivalent:
`gh pr comment` with an image URL, or push them to a branch and link). One
`Closes #n` line **per issue in the batch** — that is what makes merging the PR
close all of them.

## 8. Mark the batch Done

Only after the PR is open (and merged, if you were asked to merge):

```sh
bash skills/work-project-tasks/set-status.sh Done <itemId> [<itemId> ...]
```

Post the same in the channel, then report: the PR URL, the issues it closes,
what you verified, and anything you deliberately left out.

---

## If you can't finish

Mark it **`Blocked`** and say why. An item left in `In Progress` with nobody on
it is worse than one honestly blocked — the board claims it's being handled when
it isn't.

Both steps are required. The status is the signal, the comment is the reason,
and a status with no reason just hands a human the same puzzle you had.

```sh
bash skills/work-project-tasks/set-status.sh Blocked <itemId> [<itemId> ...]

gh issue comment <n> --repo freeflow-community/flow --body "$(cat <<'EOF'
**Blocked:** <the one-line reason>

<what you tried, and what you need — a decision, a credential, a spec answer.>
EOF
)"
```

Block the **whole batch**, and comment on **every issue in it**. Whoever picks it
up will be looking at one of them, not necessarily the one you chose. Post the
reason in the Flow channel as well — that's where someone is watching.

**`Blocked`, not back to `Queued for Dev`.** Re-queueing hides the problem: the
next agent takes the task and walks into the same wall. A human moves it back to
`Queued for Dev` once the blocker is resolved — that's their call, not yours.

Write the comment for someone who wasn't there. Name the specific decision or
missing fact, not "couldn't get it working". If the task is underspecified, ask
the precise question rather than guessing — a wrong guess costs more than a
round trip.

## Rules worth restating

- **Don't start `Todo` work.** If the queue is empty, the answer is "nothing is
  queued", not "here's something from the backlog I picked".
- **Don't split or merge batches.** The grouping is a human decision about what
  belongs in one review.
- **Don't mark Done without a PR.** Done means the change exists and is
  reviewable, not that you finished editing.
- **Don't leave anything in `In Progress`.** Every task you claim ends the run
  as `Done` or `Blocked`.
- **Don't retry a `Blocked` task.** It's blocked on a human, not on effort.
- **Don't push to `main`.** Everything goes through a PR.
- **Don't leave your servers running.** The run ends with the machine as you
  found it — your dev server, app builds and simulator app stopped, and any
  system setting you changed put back.
- **Don't work silently.** If the channel exists, the run should be legible from
  it alone.
