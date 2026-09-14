# Mini apps 4/4 — the Task Board runs behind the app-guard

- `[bridge]` Document the promote path: `create_artifact` on a url already
  pinned as a plain link upgrades that artifact into an app in place and
  returns its secret, so it keeps its id and sidebar entry. Bridge 0.26.1.
- `[qa]` Deployment (outside this repo): the Task Board artifact in #factory is
  now an app, `flow-agent-bridge app-guard` fronts it, the tunnel points at the
  guard and the bare tunnel that anyone with the URL could read since 18 Aug is
  retired — it answers 530 now.
- `[qa]` `task-board@e2ca7b4` pages the project's `items` connection. It caps
  at 100 and the project passed 100 on 26 Aug, so the board and its 5s status
  poll had both gone blind to every issue after #374.
- `[qa]` The board reads `X-Flow-User-Name` off the guard: it shows who you are,
  logs writes with your name, and signs the issues **New task** files.
- `docs/design/MINI_APPS.md` moves from draft spec to built, with the
  conversion order the next app will need.

## Feature

- **The Task Board is now members-only.** It used to be protected by nothing
  but an unguessable link. Open it from #factory and it signs you in and greets
  you by name; open the URL any other way and it won't let you in at all.
- **The board stopped hiding new tasks.** It could only ever show the first 100
  items on the project, so anything filed recently was missing. Everything
  shows now.
