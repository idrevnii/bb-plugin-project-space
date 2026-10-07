# Roadmap

This page lists what is built and what comes next, by milestone. ***The
MVP, wave 1, wave 2 and the item for later are merged.*** Each
item had a brief in [tasks](tasks/index.md), and the
[status list](tasks/index.md#status) shows its state.

> [!IMPORTANT] Open now
> No task is open.

## MVP (0.1)

- [x] Full-screen **Space** screen (`navPanel`) with a deep link for each
  file: `/plugins/project-space/space/<projectId>/<path>`
- [x] File tree in the right panel of the host (**Files** tab), or next to
  the document with *File tree position*
- [x] Make pages, canvases, HTML files and folders; rename; delete
- [x] Markdown reader: GFM tables and task lists, code blocks in the source
  viewer of bb, links between pages
- [x] Edit with <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd>; saves are
  compare-and-swap, with a conflict banner
- [x] HTML in a sandboxed iframe from a bb file preview URL, so relative
  assets load
- [x] `.tldr` canvases with autosave; a canvas loads again when an agent
  changes it
- [x] Live refresh: a server watcher publishes `space-changed`; the app polls
  for spaces on remote machines
- [x] `bb space root | init | tree | link`, the agent skill, the `::space`
  chat card, the **Space** button in thread headers
- [x] **Agent drawing**: `space_draw`, `space_canvas_read`,
  `bb space draw | canvas`; the open canvas or an off-screen tldraw in any
  bb window applies the drawing (ported from
  [bb-plugin-canvas](https://github.com/Borjampm/bb-plugin-canvas))

## Wave 1 — editing, navigation, canvas checks

- [x] **WYSIWYG Markdown** — TipTap edits the page directly, with a *Source*
  toggle (T11)
- [x] **Mermaid** in Markdown code fences (T12)
- [x] **Tree and navigation**
  - [x] Drag and drop in the tree, and *Move to…* (T13)
  - [x] Outline tab (T14)
  - [x] Search in the space (T15)
  - [x] Links to project files outside the space (T16)
- [x] **Canvas checks for agents**
  - [x] Overlap lint after each draw (T17)
  - [x] `space_canvas_view`: a PNG of a canvas (T18)
- [x] **Worktree awareness**: show worktrees that changed the space (T19)
- [x] **Unit tests** for the pure core and `space_write`; line coverage of
  `lib/` is 98 % (T20)
- [x] **Annotations data layer**: model, text-quote anchors, storage, RPC
  (T10)
- [x] **Reading styles** (Blue Topaz, Things, plain) and two bb themes
- [x] **Rich Markdown**: callouts, highlights, footnotes, safe inline HTML
- [x] **UI QA sweep** of the Space screen: seven flows in scripts, seven bugs
  repaired (T21)

## Wave 2 — comments

Select text or shapes, write a comment, collect the comments in a review
tab, and send them to a thread. See [the decision](decisions/annotations.md).

- [x] Comments on Markdown pages (T30)
- [x] Review tab and *Send to…* a thread (T31)
- [x] `bb space annotations` and the agent tool (T32)
- [x] Comments on canvases (T33)
- [x] Comments on HTML pages (T34)

## Later

- [x] Copy the space edits of a worktree into the main space from the badge
  (T35)
