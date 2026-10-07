# Architecture

**Diagram:** [how it fits together](diagram.tldr) — a tldraw canvas drawn with
the plugin's own `bb space draw`.

```
┌──────────── bb app (browser) ─────────────┐      ┌──── bb server ─────┐
│ Space page (navPanel)    Files tab        │ RPC  │ server/            │
│  ├ MarkdownView          (fixedTab, flush)│◀────▶│  space_* handlers  │
│  ├ HtmlFrame  ──iframe──▶ /api/v1/file-previews/<token>/<path>        │
│  ├ TldrawView            FileTree         │      │  fs.watch ─┐       │
│  └ TextDocument (edit)                    │◀─────│  realtime  ◀┘      │
└───────────────────────────────────────────┘      └────────┬───────────┘
                                                            │ bb.sdk.files
                                                  <checkout>/.bb-space/
```

## Pieces

- **`server/`** is split into modules. `index.ts` defines the settings,
  builds a shared context (`bb`, settings, and the helpers from `space.ts`)
  and lists the modules; each module (`defineModule` in `context.ts`) owns an
  RPC contract, its handlers, and optional `bb space` subcommands. The
  contracts merge into one `rpcContract` the app types its client with, and
  `cli.ts` merges the subcommands. Adding a feature is a new module plus one
  entry in `modules`.
  - `space.ts` resolves a project to its default source (`hostId` + checkout
    path), runs the watcher, and holds the shared zod path schemas. All file
    I/O goes through `bb.sdk.files` with that host and a `rootPath`
    confinement, so a project on an enrolled machine works the same as a
    local one.
  - `files.ts` — the `space_*` file RPC and `bb space root|init|tree`.
  - `annotations.ts` — annotation storage, `annotations_*` RPC, and
    following moves/removes (see [annotations](annotations.md)).
  - `draw.ts` — the drawing queue, agent tools, `space_draw_*` RPC and
    `bb space draw|canvas` (see *Agent drawing* below).
  - `cli.ts` — `bb space`, `link`, and helpers (`projectOption`,
    `requireProject`, `readInvokerFile`).
- **`ui/page/`** is the Space page: `routing.ts` (route ⇄ subPath,
  navigation, tree-position setting), `SpacePage.tsx` (project fallback and
  "create space"), `ProjectSpace.tsx` (picks the document and lays it out),
  `Toolbar.tsx`, `TextDocument.tsx` (view/edit with compare-and-swap),
  `HtmlFrame.tsx`, `BinaryDocument.tsx`, `ProjectPicker.tsx`,
  `ProjectSwitcher.tsx` (host header) and `FilesTab.tsx` (right panel).
- **Live updates.** When the project's host is the server machine, a
  watch on every directory of `.bb-space/` publishes `space-changed`
  (debounced 250 ms; [server/watch-tree.ts](../../server/watch-tree.ts)).
  Not Node's `recursive: true`: on Linux it watches files one by one and
  loses any file replaced by rename, which is how saves land. Otherwise the
  app polls every 5 s while visible.
- **Unloadable canvases.** A `.tldr` tldraw cannot load opens read-only with
  the reason shown, and nothing — the user, `space_draw`, a renderer — saves
  over it until the file is fixed on disk.
- **HTML and images** load from `bb.sdk.files.createPreview` — a temporary,
  path-shaped URL confined to the space. HTML runs in an iframe sandboxed
  *without* `allow-same-origin`, so it cannot reach bb.
- **`lib/space.ts`** holds the path rules shared by both
  sides: normalization (no `..`, no absolute paths), file kinds, and link
  resolution inside Markdown.
- **Routing.** The page owns `/plugins/project-space/space/*`; the first
  segment is the project id, the rest is the file path. The Files tab gets
  the same `subPath`, so page and tree agree without shared state.

## Saving

Every save is a compare-and-swap on the sha256 the editor started from.
A mismatch means someone (usually an agent) wrote the file meanwhile: the
editor offers *Discard mine* or *Overwrite*. Canvases autosave 800 ms after
the last edit and reload on outside changes when nothing is unsaved.

## Agent drawing

Agents send a boxes-and-arrows spec (`space_draw` tool or `bb space draw`).
tldraw only runs in the browser, so the server queues the batch in the
plugin's SQLite and publishes `space-draw`:

1. If the canvas is open, it applies the batch at once, saves, and acks.
2. Otherwise every bb window keeps an off-screen tldraw editor
   (`ui/headless.tsx`) that polls the queue every 3 s, loads the file,
   applies, saves with compare-and-swap, and acks.
3. The tool waits up to 12 s for the ack and answers with the canvas as text
   (`lib/canvas/read.ts`), so the agent sees what landed.

Shape ids derive from spec ids (`shape:node-<id>`), so re-sending a node
updates it and a double apply converges.

See also: [file formats](file-formats.md), [annotations](annotations.md).
