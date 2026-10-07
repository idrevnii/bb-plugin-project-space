# AGENTS.md

Project Space is a bb plugin that shows the `.bb-space/` folder of a project
as a documentation space. This repository documents itself in
[`.bb-space/`](.bb-space/index.md). Before you change code, read the space
page for that part. The [index](.bb-space/index.md) links all pages.

## Finish a task

Run `bb status` to see your environment. It sets the mode of work.

### In the main checkout (the usual mode)

You work on `main` in the project checkout. A task is done only when all of
these are true. Do them in this order:

1. `npm run check` passes.
2. You ran `bb plugin build && bb plugin reload project-space`.
3. The e2e scripts for the parts that you changed pass:
   `node scripts/e2e/<name>.mjs`. A UI change adds or extends a script.
4. The task is ticked in the status list of
   [`tasks/index.md`](.bb-space/tasks/index.md) and in
   [`roadmap.md`](.bb-space/roadmap.md). The brief has a *Result* section.
5. All of the work is in **one commit on `main`** with the task id in the
   subject.

Other threads can work in the same checkout. Add only the files that you
changed (`git add <path>`), not `git add -A`. Do not edit a file while
another thread edits it.

### In a worktree (a wave of parallel tasks)

You work on the branch `task/<id>` in your own worktree.

1. Run only `npm run check`. Do not run `bb plugin install` or
   `bb plugin reload`: the installed plugin uses the main checkout, so a
   reload from a worktree replaces it for all agents.
2. Do not edit `roadmap.md` or the status list in `tasks/index.md`.
3. Commit on your branch and report what changed and how you checked it.

The integrator merges the branches in the main checkout and does steps 2–5
of the usual mode. Then the integrator deletes the branch and archives the
task thread, so that bb removes the worktree. Details:
[Develop the plugin → Run a wave in worktrees](.bb-space/guides/developing.md#run-a-wave-in-worktrees).

## Rules that the code does not show

- Do not import `@get-bb/plugin-sdk` or `node:*` in `lib/`. The server and
  the app bundle both import `lib/`.
- Read and write space files through `bb.sdk.files`, because projects on
  remote machines must work. Use `node:fs` only as a fast path when the
  project host is this machine, as `server/watch-tree.ts` does.
- Save with compare-and-swap on the sha256 of the file. On a conflict, show
  the banner. Do not merge.
- Do not save over a file that you cannot read: non-UTF-8 text, or a canvas
  that tldraw cannot load.
- Do not add `allow-same-origin` to the HTML iframe sandbox. Use
  `postMessage`.
- Draw canvases with `space_draw` or `bb space draw`. Do not write `.tldr`
  JSON by hand.
- Do not edit `.bb-space/.space/` (stored comments) or
  `test/fixtures/diagram.tldr` (a snapshot).
- `scripts/e2e/tree-left.mjs` and an off-screen `bb space draw` change state
  for all bb windows. Run them only when nobody uses the space.

## Docs

If a change alters behavior, update its space page in the same commit.
[Develop the plugin → Update the docs](.bb-space/guides/developing.md#update-the-docs)
lists the page for each kind of change. A changed `bb space` command or agent
tool also changes [`skills/project-space/SKILL.md`](skills/project-space/SKILL.md).

Write space pages with the skill's *Write for a reader* rules and in
[Simplified Technical English](.bb-space/decisions/simple-english.md). Do not
add Markdown files at the repository root.

## Commits

- A task from [`tasks/`](.bb-space/tasks/index.md) ends with its commit. Do
  not wait for the user to ask. For other work, commit when the user asks.
- The subject is a plain sentence with the task id, for example
  `Review tab and sending annotations to a thread (T31)`.
- The body tells what changed for the user and how you checked it: which
  e2e scripts ran, and what you did not check.
- Name each new dependency and the reason for it.
