# Roadmap

What is built and what comes next, by milestone. ***The MVP and wave 1 are
merged; the annotations UI is what is left.*** Each open item
is a brief in [tasks](tasks/index.md), with its state in the
[status table](tasks/index.md#status).

> [!IMPORTANT] Open now
> **Annotations UI**: T30 and T31 are merged; T32–T34 can start.

## MVP (0.1)

- [x] Full-screen **Space** page (`navPanel`) with a deep link per file:
  `/plugins/project-space/space/<projectId>/<path>`
- [x] File tree in the host's right panel (**Files** tab), or beside the
  document via *File tree position*
- [x] Create pages, canvases, HTML files and folders; rename; delete
- [x] Markdown reader: GFM tables and task lists, code blocks through bb's
  source viewer, links between pages
- [x] Editing with <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd> and
  compare-and-swap saves with a conflict banner
- [x] HTML in a sandboxed iframe from a bb file-preview URL, so relative
  assets load
- [x] `.tldr` canvases with autosave; agent rewrites reload the board
- [x] Live refresh: server-side watcher → realtime `space-changed`; polling
  for spaces on remote machines
- [x] `bb space root | init | tree | link`, the agent skill, the `::space`
  chat card, the **Space** button in thread headers
- [x] **Agent drawing**: `space_draw` / `space_canvas_read` and
  `bb space draw | canvas`, rendered by the open canvas or an off-screen
  tldraw in any bb window (ported from
  [bb-plugin-canvas](https://github.com/Borjampm/bb-plugin-canvas))

## Wave 1 — editing, navigation, canvas checks

- [x] **WYSIWYG Markdown** — TipTap editing in place, with a *Source* toggle (T11)
- [x] **Mermaid** in Markdown code fences (T12)
- [x] **Tree and navigation**
  - [x] Drag and drop in the tree, plus *Move to…* (T13)
  - [x] Outline tab (T14)
  - [x] Search across the space (T15)
  - [x] Links to project files outside the space (T16)
- [x] **Canvas checks for agents**
  - [x] Overlap lint after each draw (T17)
  - [x] `space_canvas_view`: a PNG of a canvas (T18)
- [x] **Worktree awareness**: show worktrees that changed the space (T19)
- [x] **Unit tests** for the pure core and `space_write`; `lib/` line coverage
  98 % (T20)
- [x] **Annotations data layer**: model, text-quote anchoring, storage, RPC (T10)
- [x] **Reading styles** (Blue Topaz, Things, plain) and two bb themes
- [x] **Rich Markdown**: callouts, highlights, footnotes, safe inline HTML
- [x] **UI QA sweep** across the Space page: seven flows scripted, seven bugs fixed (T21)

## Wave 2 — annotations UI

Select text or shapes, comment, collect in a review tab, send to a thread.
See [the decision](decisions/annotations.md).

- [x] Annotate Markdown pages (T30)
- [x] Review tab and *Send to…* a thread (T31)
- [ ] `bb space annotations` and the agent tool (T32)
- [ ] Annotate canvases (T33)
- [ ] Annotate HTML pages (T34)

## Later

- [ ] Copy a worktree's space edits into the main space from the badge
  (follow-up to T19)
