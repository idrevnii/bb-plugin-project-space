# Developing the plugin

How to prove a change works, and how several agents work on the plugin at
once without stepping on each other. ***Every change passes `npm run check`;
UI changes also pass `npm run e2e` against the installed plugin.***

## Prove a change

Prerequisites:

- Node and npm, and a running bb.
- This repository as the **main checkout** the installed plugin points at.

1. Install dependencies:

   ```sh
   npm install
   ```

2. Typecheck, run the unit tests and build:

   ```sh
   npm run check
   ```

3. Load the build into bb:

   ```sh
   bb plugin build && bb plugin reload project-space
   ```

   > [!CAUTION] Never install or reload from a worktree
   > The installed plugin points at the main checkout. Reloading from a
   > worktree swaps it out under every other agent.

4. Run the browser checks against it:

   ```sh
   npm run e2e
   ```

5. Check it worked: each script prints an `ok` line per check and stops at
   the first failure with a non-zero exit; screenshots land in
   `scripts/e2e/out/` (gitignored).

| Script | Does |
| --- | --- |
| `npm run check` | `typecheck` + `test` + `bb plugin build` |
| `npm test` | unit tests only (vitest) |
| `npm run coverage` | unit tests + line coverage of `lib/`, HTML in `coverage/` |
| `npm run e2e` | every script in `scripts/e2e/`, one after another |

## Unit tests

Unit tests are `test/*.test.ts`, one file per module under test. Pure `lib/`
code is tested directly; server handlers run on `createFakePluginHost`,
stubbing only the `bb.sdk` calls they make. **Keep `lib/` line coverage above
80 %** (it is 98 % today).

| File | Covers |
| --- | --- |
| `space.test.ts`, `links.test.ts` | `lib/space.ts`: path normalization, link resolution (inside the space and out to checkout files, `#L` hashes), file kinds, names |
| `callouts.test.ts` | `lib/callouts.ts`: GitHub and Obsidian markers, fold and title, unknown types, writing markers back |
| `canvas-layout.test.ts` | `lib/canvas/layout.ts`: box sizes, `lr`/`tb` layering, cycles, anchoring, title placement |
| `canvas-read.test.ts` | `lib/canvas/read.ts` against `test/fixtures/diagram.tldr`, plus empty and broken files |
| `canvas-spec.test.ts` | `lib/canvas/spec.ts`: colors, shapes, size limits |
| `canvas-lint.test.ts` | `lib/canvas/lint.ts`: overlapping shapes, labels that do not fit |
| `canvas-image.test.ts` | `server/canvas-image.ts`: `space_canvas_view` and `bb space canvas --png` |
| `annotations.test.ts` | `lib/annotations.ts`: `quoteSelector`, `locateQuote` (exact and fuzzy) |
| `annotations-store.test.ts` | `server/annotations.ts`: storage, conflicts, following moves and removes |
| `files-rpc.test.ts` | `space_write` / `space_read` on the SDK's fake host with `bb.sdk.files` over a Map: conflicts, path rejection |
| `search.test.ts` | `lib/search.ts`: text and canvas matching, snippets, which files are read; `headingAtLine` |
| `outline.test.ts` | `ui/outline.ts`: headings and ids that match the rendered page |
| `tree-move.test.ts` | `ui/tree-move.ts`: legal moves, the open document following them |
| `markdown-roundtrip.test.ts` | the TipTap schema (`ui/page/markdown-extensions.ts`): Markdown in, the same Markdown out |
| `watch-tree.test.ts` | `server/watch-tree.ts`: new directories and files replaced by rename are seen |
| `worktrees.test.ts` | `lib/worktrees.ts` and `?env=` in the route |

> [!NOTE] The canvas fixture is a snapshot
> `test/fixtures/diagram.tldr` is an old copy of the architecture diagram. If
> a test needs a new kind of shape, edit the fixture, not the live diagram.

## End-to-end checks

`npm run e2e` drives a real bb server with Playwright, so the installed
plugin must be the one you want to test. The scripts create only
`scratch-e2e*` files in the space and delete them when they finish, pass or
fail.

| Script | Proves |
| --- | --- |
| `smoke.mjs` | `index.md`, an HTML report and a canvas open without page errors; opening the canvas leaves its file untouched |
| `live-refresh.mjs` | text appended to a page on disk shows up without a reload |
| `draw.mjs` | `bb space draw` lands with the canvas closed and with it open |
| `annotations.mjs` | `annotations_*` RPC: create, list, update; annotations follow `space_move` and go with `space_remove` (no browser) |
| `markdown-editor.mjs` | editing a table cell, ticking a task and adding a link in the WYSIWYG editor save to disk; *Source* shows the same text |
| `mermaid.mjs` | two diagrams and one parse error render in light and dark, and re-render on a theme flip |
| `formatting.mjs` | callouts (one foldable), highlights, `<kbd>`/`<mark>`/`<details>` and footnotes render; `<script>` is dropped; the editor keeps them on save |
| `tree-dnd.mjs` | drag and drop and *Move to…* in the tree; the open document follows; illegal drops are refused |
| `draw-lint.mjs` | an overlapping draw ends with an *Overlaps* section and the fix hint; a clean redraw reports none |
| `outline.mjs` | the Outline tab lists headings, a click scrolls, scrolling moves the highlight; a canvas has no outline |
| `search.mjs` | `bb space search` finds by name, text and canvas label; the search box replaces the tree, <kbd>Esc</kbd> clears, <kbd>Enter</kbd> opens, a text hit scrolls to its section |
| `outside-links.mjs` | a link out of the space opens the checkout file at its line or range; a link escaping the checkout is plain text |
| `canvas-view.mjs` | `bb space canvas --png` right after a draw shows the new drawing, off-screen and open; a hand-edited file is re-rendered, not served stale |
| `canvas-readonly.mjs` | a canvas tldraw cannot load is read-only and never saved over; fixing the file makes it editable again |
| `worktrees.mjs` | a page added in a worktree's `.bb-space` shows in the badge, opens read-only, and drops out once deleted; skipped without a worktree |
| `tree-rename-delete.mjs` | renaming the open page or its folder keeps it open; a rename onto an existing name is refused; deleting the open page or its folder opens the start page |
| `tree-left.mjs` | *File tree position* = `left`: the tree beside the document, opening and creating there, a canvas filling the column; switching back is live (restores the setting) |
| `space-links.mjs` | the thread-header **Space** button, labelled and icon-only; the newest `::space` card in a thread and its *Open in space* (skipped when the thread has none) |
| `edit-conflict.mjs` | a page changed on disk while edited: the banner, a refused Save, *Discard mine* and *Overwrite*, in WYSIWYG and *Source* |
| `canvas-conflict.mjs` | an agent rewriting an open canvas: *Load theirs*, *Keep mine*, a rewrite during an in-flight save, the board's own save echoing back |
| `odd-files.mjs` | non-UTF-8 and binary files get a notice and stay untouched; a NUL in a `.txt`; an image; a 5 MB page; empty folders |
| `console-warnings.mjs` | no bb DOM-guard warning ("tried to move … out of React's tree") blames the plugin |

The scripts take their target from the environment:

| Variable | Default |
| --- | --- |
| `BB_URL` | `http://127.0.0.1:38886` |
| `PROJECT_ID` | `$BB_PROJECT_ID` (set inside a bb thread) |
| `CHROME_PATH` | Playwright's Chromium (`npx playwright install chromium`) |
| `THREAD_ID` | `$BB_THREAD_ID`, else the project's newest thread (`space-links.mjs`) |
| `CARD_THREAD_ID` | `THREAD_ID`: the thread whose `::space` card is opened |

Helpers in [`scripts/e2e/lib.mjs`](../../scripts/e2e/lib.mjs): `run(body, cleanup)`
runs the cleanup even when `fail()` stops the body; `showFiles(page)` brings
back the Files tab, which bb restores to whatever tab was last open.

> [!WARNING] Some scripts change shared state while they run
> `tree-left.mjs` flips the *File tree position* setting for every bb window,
> and `bb space draw` with no window open queues a drawing that lands the
> next time any window opens. Run them when nobody is using the space.

## Work in parallel

Work is cut into [task briefs](../tasks/index.md). For each task:

1. **Work in your own worktree** on branch `task/<id>`. Keep the diff inside
   the files your brief owns; changes elsewhere stay small and additive, and
   the report says so.
2. **Verify locally** with `npm run check`. UI tasks also add or extend a
   script in `scripts/e2e/` that exercises the feature.
3. **Do not install or reload the plugin** — live checks happen at
   integration.
4. **Update the docs** your brief names. ==Only the integrator edits the
   roadmap and the task index.==
5. **Report** what changed, how it was verified, what is left undone, and
   screenshots for UI.

## Integrate a branch

Merge branches in wave order. After each merge, in the main checkout:

```sh
bb plugin build && bb plugin reload project-space
npm run e2e
```

Then tick the task in the [roadmap](../roadmap.md) and the
[task status](../tasks/index.md#status).
