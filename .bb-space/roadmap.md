# Roadmap

## Done — MVP (0.1)

- [x] Full-screen **Space** page (`navPanel`) with a deep link per file:
  `/plugins/project-space/space/<projectId>/<path>`
- [x] File tree in the host's right panel (**Files** tab), or beside the
  document via the *File tree position* setting
- [x] Create pages, canvases, HTML files, and folders; rename; delete
- [x] Markdown reader with document typography, GFM tables and task lists,
  code blocks through bb's own source viewer, links between pages
- [x] Markdown/HTML/text editing: source on the left, live preview on the
  right, `Ctrl/⌘+S`, compare-and-swap saves with a conflict banner
- [x] HTML rendered in a sandboxed iframe from a bb file-preview URL, so
  relative assets load
- [x] `.tldr` canvases with autosave; agent rewrites reload the board
- [x] Live refresh: server-side `fs.watch` → realtime `space-changed`;
  polling fallback for spaces on remote machines
- [x] `bb space root | init | tree | link`, agent skill, `::space` chat card,
  **Space** button in thread headers
- [x] **Agent drawing** — `space_draw` / `space_canvas_read` tools and
  `bb space draw | canvas`: a boxes-and-arrows spec with auto-layout, queued
  on the server and rendered by the open canvas or an off-screen tldraw in any
  bb window (ported from
  [bb-plugin-canvas](https://github.com/Borjampm/bb-plugin-canvas))

## Next

Broken down into parallel briefs in [tasks](tasks/index.md); progress per task
is in [its status table](tasks/index.md#status).

- [ ] **Annotations** — select text (Markdown/HTML) or shapes (tldraw), comment,
  collect in a review tray, send to a thread. See
  [the annotations decision](decisions/annotations.md).
  - [x] Data layer: model, text-quote anchoring, storage, RPC (T10)
  - [ ] Markdown, review tab, agent API, tldraw, HTML (T30–T34)
- [x] **WYSIWYG Markdown** — TipTap editing in place of the source pane, with a
  *Source* toggle (T11)
- [ ] **Canvas checks for agents**
  - [x] Overlap lint after each draw (T17)
  - [ ] `space_canvas_view`: a PNG of a canvas so agents can check their
    drawing (T18)
- [x] **Mermaid** in Markdown code fences (T12)
- [ ] **Tree and navigation**
  - [x] Drag and drop in the tree, plus *Move to…* (T13)
  - [ ] Outline tab (T14)
  - [ ] Search across the space (T15)
  - [ ] Links to project files outside the space (T16)
- [ ] **Worktree awareness**: show when a thread's worktree has unmerged space
  edits (T19)
