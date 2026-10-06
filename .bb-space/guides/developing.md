# Developing the plugin

How to prove a change works, and how several agents work on the plugin at
once without stepping on each other.

## Commands

```sh
npm install
npm run check    # typecheck + unit tests (vitest) + bb plugin build
npm test         # unit tests only; they live in test/
npm run e2e      # browser checks against the installed plugin
```

`npm run e2e` drives a real bb server with Playwright, so the installed
plugin must be the one you want to test. From the **main checkout** only:

```sh
bb plugin build && bb plugin reload project-space
npm run e2e
```

The scripts live in `scripts/e2e/` and run one after another:

| Script | Proves |
|---|---|
| `smoke.mjs` | `index.md`, an HTML report, and a `.tldr` canvas open without page errors |
| `live-refresh.mjs` | text appended to a page on disk shows up without a reload |
| `draw.mjs` | `bb space draw` lands with the canvas closed and with it open |
| `tree-dnd.mjs` | drag and drop and *Move to…* in the Files tree; the open document follows; illegal drops are refused |

They take their target from the environment:

| Variable | Default |
|---|---|
| `BB_URL` | `http://127.0.0.1:38886` |
| `PROJECT_ID` | `$BB_PROJECT_ID` (set inside a bb thread) |
| `CHROME_PATH` | Playwright's Chromium (`npx playwright install chromium`) |

Screenshots go to `scripts/e2e/out/` (gitignored). The scripts create only
`scratch-e2e*` files in the space and delete them when they finish, pass or
fail.

## Working in parallel

Work is cut into [task briefs](../tasks/index.md). For each task:

1. **Work in your own worktree** on branch `task/<id>`. Keep the diff inside
   the files your brief owns; changes elsewhere stay small and additive, and
   the report says so.
2. **Verify locally:** `npm run check`. UI tasks also add or extend a script
   in `scripts/e2e/` that exercises the feature.
3. **Never `bb plugin install` or `bb plugin reload` from a worktree.** The
   installed plugin points at the main checkout; reinstalling from a worktree
   swaps it out under every other agent. Live checks happen at integration.
4. **Docs:** update or add the space page your brief names. The integrator
   alone edits the roadmap and the task index.
5. **Report** what changed, how it was verified, what is left undone, and
   screenshots for UI.

## Integrating

Merge branches in wave order. After each merge, in the main checkout:
`bb plugin build && bb plugin reload project-space`, `npm run e2e`, then tick
the roadmap.
