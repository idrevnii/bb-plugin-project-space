# T00 · Repository baseline

Make the plugin a git repository with tests and an end-to-end harness, so
later tasks can run in parallel worktrees and prove their work.

> [!success] Merged 2026-10-07
> Wave 0 · depends on: nothing · blocks: everything. Documented now in [Developing](../guides/developing.md).

## Read first

- [README](../../README.md), [architecture](../architecture/index.md)
- `package.json`, `tsconfig.json`

## Do

1. `git init`, keep the existing `.gitignore` (`dist/`, `node_modules/`), make
   the initial commit of the current tree (including `.bb-space/`).
2. Add `vitest` (devDependency) and `npm test` (`vitest run`). One trivial
   test for `lib/space.ts → normalizeSpacePath` so the harness is proven.
3. Add `playwright` as a devDependency and move the ad-hoc browser checks into
   `scripts/e2e/` as parameterized scripts (`BB_URL`, default
   `http://127.0.0.1:38886`; `PROJECT_ID`):
   - `smoke.mjs` — open `index.md`, an HTML page, and a `.tldr`; fail on page
     errors; save screenshots to `scripts/e2e/out/` (gitignored).
   - `live-refresh.mjs` — append to a page from disk, expect it on screen.
   - `draw.mjs` — `bb space draw` a two-node spec into `scratch-e2e.tldr`
     with and without the canvas open; expect both to land; delete the file.
   `npm run e2e` runs all three.
4. Add `npm run check` = typecheck + test + `bb plugin build`.

## Acceptance

- [ ] `git log` shows the baseline commit; `git status` is clean afterwards.
- [ ] `npm run check` passes.
- [ ] `npm run e2e` passes against the installed plugin and leaves no files
      behind in `.bb-space/`.

## Out of scope

Behavior changes of any kind.

## Docs

Add `guides/developing.md`: the check/e2e commands and the parallel-work
rules from [tasks](index.md).
