# Architecture

**Diagram:** [how it fits together](diagram.tldr) — a tldraw canvas drawn with
the plugin's own `bb space draw`.

```
┌──────────── bb app (browser) ─────────────┐      ┌──── bb server ─────┐
│ Space page (navPanel)    Files tab        │ RPC  │ server.ts          │
│  ├ MarkdownView          (fixedTab, flush)│◀────▶│  space_* handlers  │
│  ├ HtmlFrame  ──iframe──▶ /api/v1/file-previews/<token>/<path>        │
│  ├ TldrawView            FileTree         │      │  fs.watch ─┐       │
│  └ TextDocument (edit)                    │◀─────│  realtime  ◀┘      │
└───────────────────────────────────────────┘      └────────┬───────────┘
                                                            │ bb.sdk.files
                                                  <checkout>/.bb-space/
```

## Pieces

- **`server.ts`** resolves a project to its default
  source (`hostId` + checkout path) and serves the `space_*` RPC. All file
  I/O goes through `bb.sdk.files` with that host and a `rootPath`
  confinement, so a project on an enrolled machine works the same as a local
  one.
- **Live updates.** When the project's host is the server machine, a
  recursive `fs.watch` on `.bb-space/` publishes `space-changed` (debounced
  250 ms). Otherwise the app polls every 5 s while visible.
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

See also: [file formats](file-formats.md).
