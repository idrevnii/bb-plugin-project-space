# Developing the plugin

How to prove a change works, and how several agents work on the plugin at
once without stepping on each other.

## Commands

```sh
npm install
npm run check    # typecheck + unit tests (vitest) + bb plugin build
npm test         # unit tests only; they live in test/
npm run coverage # unit tests + line coverage of lib/ (HTML in coverage/)
npm run e2e      # browser checks against the installed plugin
```

## Unit tests

Unit tests are `test/*.test.ts` (vitest), one file per module under test:

| File | Covers |
|---|---|
| `space.test.ts`, `links.test.ts` | `lib/space.ts`: path normalization, link resolution (inside the space and out to checkout files, `#L` line hashes), file kinds, names |
| `canvas-layout.test.ts` | `lib/canvas/layout.ts`: box sizes, `lr`/`tb` layering, cycles, anchoring, title placement |
| `canvas-read.test.ts` | `lib/canvas/read.ts` against `test/fixtures/diagram.tldr` (a copy of the architecture diagram), plus empty and broken files |
| `canvas-spec.test.ts` | `lib/canvas/spec.ts`: colors, shapes and size limits |
| `canvas-lint.test.ts` | `lib/canvas/lint.ts`: overlapping shapes and labels that do not fit |
| `canvas-image.test.ts` | `server/canvas-image.ts`: `space_canvas_view` and `bb space canvas --png` |
| `annotations.test.ts` | `lib/annotations.ts`: `quoteSelector`, `locateQuote` (exact and fuzzy) |
| `annotations-store.test.ts` | `server/annotations.ts`: storage, conflicts, following moves and removes |
| `files-rpc.test.ts` | `space_write` / `space_read` handlers on the SDK's fake host (`@get-bb/plugin-sdk/testing`) with `bb.sdk.files` stubbed over a Map: conflicts and path rejection |
| `search.test.ts` | `lib/search.ts`: text and canvas matching, snippets, which files are read; `headingAtLine` |
| `outline.test.ts` | `ui/outline.ts`: headings and ids that match the rendered page |
| `tree-move.test.ts` | `ui/tree-move.ts`: legal moves and the open document following them |
| `markdown-roundtrip.test.ts` | the TipTap schema (`ui/page/markdown-extensions.ts`): Markdown in, the same Markdown out |
| `watch-tree.test.ts` | `server/watch-tree.ts`: new directories and files replaced by rename are seen |
| `worktrees.test.ts` | `lib/worktrees.ts` and `?env=` in the route |

Pure `lib/` code is tested directly. Server handlers run on
`createFakePluginHost`, stubbing only the `bb.sdk` calls they make. Keep
`lib/` line coverage above 80% (`npm run coverage`).

The fixture is a snapshot: if a test needs a new kind of shape, edit the
fixture, not the live diagram.

## End-to-end checks

`npm run e2e` drives a real bb server with Playwright, so the installed
plugin must be the one you want to test. From the **main checkout** only:

```sh
bb plugin build && bb plugin reload project-space
npm run e2e
```

The scripts live in `scripts/e2e/` and run one after another:

| Script | Proves |
|---|---|
| `smoke.mjs` | `index.md`, an HTML report, and a `.tldr` canvas open without page errors; opening the canvas leaves its file untouched |
| `live-refresh.mjs` | text appended to a page on disk shows up without a reload |
| `draw.mjs` | `bb space draw` lands with the canvas closed and with it open |
| `annotations.mjs` | the `annotations_*` RPC: create, list, update; annotations follow `space_move` and go with `space_remove` (no browser) |
| `markdown-editor.mjs` | editing a table cell, ticking a task and adding a link in the WYSIWYG editor save to disk; *Source* shows the same text |
| `mermaid.mjs` | mermaid blocks render (two diagrams, one parse error) in light and dark, and re-render on a theme flip |
| `draw-lint.mjs` | an overlapping draw ends with an *Overlaps* section and the fix hint; a clean redraw reports none |
| `outline.mjs` | the Outline tab lists the page's headings, a click scrolls to one, scrolling moves the highlight; a canvas has no outline |
| `tree-dnd.mjs` | drag and drop and *Move to…* in the Files tree; the open document follows; illegal drops are refused |
| `search.mjs` | `bb space search` finds pages by name, text and canvas label; the Files search box replaces the tree, Esc clears, Enter opens, a text hit scrolls to its section |
| `outside-links.mjs` | a link out of the space opens the checkout file in bb's preview at its line or range; a link escaping the checkout is plain text; space links still route |
| `canvas-view.mjs` | `bb space canvas --png` right after a draw pictures the new drawing, off-screen and with the canvas open; a hand-edited file is re-rendered, not served stale |
| `canvas-readonly.mjs` | a canvas whose file tldraw cannot load is read-only and never saved over; fixing the file on disk makes it editable again |
| `worktrees.mjs` | a page added in a live worktree's `.bb-space` shows in the "worktrees changed the space" badge, opens read-only from the worktree (popover and `?env=` link), and drops out once deleted; skipped without a worktree |

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
