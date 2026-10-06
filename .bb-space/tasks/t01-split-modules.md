# T01 · Split the server and page into modules

**Wave 0 · depends on: T00 · blocks: all of wave 1**

## Goal

Pure refactor so features can be added in separate files. Today
`server.ts` (~900 lines) and `ui/SpacePage.tsx` (~760 lines) hold nearly
everything; every wave-1 task would collide there.

## Read first

- [Architecture](../architecture/index.md)
- `server.ts`, `ui/SpacePage.tsx`, `app.tsx`

## Do

1. Server → `server/`:
   - `server/space.ts` — project resolution (`resolveSpace`, `checkoutOf`,
     `absolute`), existence check, watcher + `notifyChanged`.
   - `server/files.ts` — the `space_*` file RPC (projects, info, init, tree,
     read, write, mkdir, move, remove, preview).
   - `server/draw.ts` — draw queue, `space_draw` / `space_canvas_read` tools,
     `space_draw_*` RPC, `space_canvas_config`.
   - `server/cli.ts` — the `bb space` command; each feature module can export
     `cliCommand`s that `cli.ts` merges.
   - `server/index.ts` — the factory: settings, builds a shared context
     object, calls each module's `register(ctx)`.
   - The RPC contract becomes per-module contracts spread into one
     `rpcContract` exported from `server/index.ts` (the app imports its type).
   - `package.json` `bb.server` → `./server/index.ts`.
2. Page → `ui/page/`: `routing.ts` (parseRoute, routeSubPath,
   useSpaceNavigation), `ProjectPicker.tsx`, `ProjectSwitcher.tsx`,
   `Toolbar.tsx`, `TextDocument.tsx`, `HtmlFrame.tsx`, `BinaryDocument.tsx`,
   `ProjectSpace.tsx`, `SpacePage.tsx`, `FilesTab.tsx`.
3. No renamed RPC methods, settings, routes, CLI commands or tool names.

## Acceptance

- [ ] `npm run check` passes; no file over ~300 lines except ported
      `lib/canvas/layout.ts` and `ui/canvas-apply.ts`.
- [ ] After `bb plugin build && bb plugin reload project-space` in the main
      checkout, `npm run e2e` passes unchanged.
- [ ] `git diff --stat` shows moves and splits, no behavior edits.

## Out of scope

Any feature or UI change.

## Docs

Update the *Pieces* section of [architecture](../architecture/index.md) with
the new layout.
