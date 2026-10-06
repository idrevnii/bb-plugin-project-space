---
name: project-space
description: Write or update a project's living documentation in its project space (.bb-space/) — Markdown pages, browser-rendered HTML reports, and tldraw canvases the user reads in bb's Space screen.
---

# Project space

Every bb project can have a **space**: the `.bb-space/` folder in the
project's checkout. The user reads it in bb's full-screen **Space** page
(sidebar → Space, or the Space button in a thread header). It renders
Markdown as a document, HTML as a live browser page, and `.tldr` files as a
tldraw canvas. The user edits there too, so treat it as shared, living
documentation — not a scratchpad.

Use it when the user asks you to document, explain, plan, or report on the
project in a way they will come back to. Do not dump session logs here.

## Find it

```sh
bb space root      # absolute path of the live space; creates nothing
bb space init      # create it with a starter index.md if missing
bb space tree      # what is already there
bb space search <text>   # pages by name, then by text inside (canvas labels too)
```

Write with your ordinary file tools at the path `bb space root` prints. In a
worktree, that path is the project's main checkout, so the user sees your
changes immediately; write there rather than into the worktree's own
`.bb-space/` unless the docs must ship on the branch.

## Organize it

- `index.md` is the front page. Keep it short: what the project is, and
  links to the other pages. Update its links when you add a page.
- Group pages in folders by topic (`architecture/`, `guides/`,
  `decisions/`). A folder's `index.md` opens when the folder is selected.
- One topic per page, a clear `# Title` first line, short sections. Prefer
  updating an existing page over adding a near-duplicate.
- Link between pages with relative Markdown links: `[Deploy](../guides/deploy.md)`.
  Images and other assets go next to the page and are linked relatively.
- Link to code the same way, climbing out of `.bb-space/`:
  `[server](../../server/index.ts#L10)` from `guides/x.md` opens the file in
  bb's preview at line 10 (`#L10-L24` highlights a range).
- Names: lowercase-kebab-case (`request-lifecycle.md`).

## Pick the format

- **Markdown (`.md`)** — the default: explanations, guides, decisions.
  GitHub-flavored Markdown (tables, task lists, fenced code with a language).
- **HTML (`.html`)** — when the content is visual or interactive: dashboards,
  comparisons, styled reports, small demos. Write a complete, self-contained
  document; relative assets beside it load normally. It runs in a sandbox
  with scripts allowed but no access to bb.
- **tldraw (`.tldr`)** — diagrams: architecture, flows, relationships. Never
  hand-write tldraw JSON; draw with the tool below.

## Draw diagrams

Use the `space_draw` tool (or `bb space draw <path.tldr> --spec-file spec.json`
when the tool is not available). The spec:

```json
{
  "clear": true,
  "layout": "tb",
  "texts": [{ "id": "title", "text": "Request lifecycle", "size": "xl" }],
  "nodes": [
    { "id": "api", "label": "API gateway", "color": "blue" },
    { "id": "db", "label": "Postgres", "shape": "ellipse", "color": "green" }
  ],
  "edges": [{ "from": "api", "to": "db", "label": "SQL" }]
}
```

- Node ids are stable handles: re-sending an id updates that node in place.
  A batch with only new ids lands below the existing drawing — pass
  `clear: true` to replace a diagram instead.
- Omit `x`/`y` for auto-layout (`lr` or `tb`). Edges that skip a layer can
  cut through boxes; for a diagram people will keep, give every node `x`, `y`,
  `w`, `h` on a grid (rows ~300 apart, columns ~550 apart) with
  `layout: "none"`.
- Keep a diagram to about a dozen nodes; split bigger ones into several files.
- Colors: black, grey, violet, light-violet, blue, light-blue, green,
  light-green, yellow, orange, red, light-red. Shapes: rect, ellipse, diamond,
  note.
- The result ends with an *Overlaps* section: shape pairs that sit on top of
  each other and boxes whose label did not fit. Fix them before moving on —
  re-send those node ids with explicit `x`/`y` (and `w`/`h`), or redraw with
  `clear: true`.
- The result text describes the canvas afterwards. Before changing a diagram
  the user may have edited, read it with `space_canvas_read`
  (`bb space canvas <path.tldr>`).
- Link the diagram from the relevant Markdown page.

## Point the user at a page

After writing, show the page as a card in chat with the directive
`bb space link <path>` prints, on its own line:

```md
::space{project="proj_…" path="architecture/overview.md" title="Architecture overview"}
```
