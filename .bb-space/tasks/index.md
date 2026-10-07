# Tasks

The [roadmap](../roadmap.md) cut into briefs an agent can take alone. Each
brief says what to build, which files it owns, and how to prove it works; the
rules every task follows are in [Developing → Work in parallel](../guides/developing.md#work-in-parallel).

> [!IMPORTANT] Open now
> T32–T34 can start: T10, which they build on, is merged.

## Waves

The [dependency map](tasks.tldr) shows which task must be merged before
which; grey boxes are merged, blue ones are open.

| Wave | Runs | Tasks |
| --- | --- | --- |
| 0 | one after another, one agent | [T00](t00-repo-baseline.md) → [T01](t01-split-modules.md) |
| 1 | in parallel, after T01 | [T10](t10-annotations-core.md) · [T11](t11-wysiwyg-markdown.md) · [T12](t12-mermaid.md) · [T13](t13-tree-dnd.md) · [T14](t14-outline-tab.md) · [T15](t15-space-search.md) · [T16](t16-outside-links.md) · [T17](t17-canvas-lint.md) · [T18](t18-canvas-view-png.md) · [T19](t19-worktree-awareness.md) · [T20](t20-unit-tests.md) · [T21](t21-ui-qa-sweep.md) |
| 2 | in parallel, after T10 | [T30](t30-annotations-markdown.md) · [T31](t31-annotations-review-tab.md) · [T32](t32-annotations-agent-api.md) · [T33](t33-annotations-tldraw.md) · [T34](t34-annotations-html.md) |

Wave 0 existed so wave 1 could run without merge pain: before it, `server.ts`
and `ui/SpacePage.tsx` held almost everything and the directory was not a git
repository, so there were no worktrees.

## Status

Updated 2026-10-07. A ticked task is merged into `main` with
`npm run check` green.

- [x] T00 Repository baseline
- [x] T01 Split the server and page into modules
- [x] T10 Annotations: model, anchoring, storage, RPC
- [x] T11 WYSIWYG Markdown editing
- [x] T12 Mermaid diagrams in Markdown
- [x] T13 Drag and drop in the file tree
- [x] T14 Outline tab
- [x] T15 Search across the space
- [x] T16 Links to project files outside the space
- [x] T17 Overlap lint for canvases
- [x] T18 Let agents see a canvas (PNG)
- [x] T19 Worktree awareness
- [x] T20 Unit tests for the pure core
- [x] T21 UI QA sweep
- [x] T30 Annotate Markdown pages
- [x] T31 Review tab and sending annotations to a thread
- [ ] T32 Annotations for agents — ready to start
- [ ] T33 Annotate canvases — ready to start
- [ ] T34 Annotate HTML pages — ready to start

## Who touches what

A brief *owns* the files it creates or mainly edits; anything else it touches
stays small and additive.

| Task | Owns | Also touches |
| --- | --- | --- |
| T10 | `lib/annotations.ts`, `server/annotations.ts` | `server/index.ts` (register) |
| T11 | `ui/page/MarkdownEditor.tsx` | `ui/page/TextDocument.tsx`, `package.json` |
| T12 | `ui/MermaidBlock.tsx` | `ui/MarkdownView.tsx` (code block branch), `package.json` |
| T13 | `ui/FileTree.tsx` | — |
| T14 | `ui/OutlineTab.tsx` | `app.tsx` (fixed tab) |
| T15 | `server/search.ts`, `ui/SearchBox.tsx` | `server/index.ts`, `ui/FileTree.tsx` (header slot) |
| T16 | — | `ui/MarkdownView.tsx` (link branch) |
| T17 | `lib/canvas/lint.ts` | `lib/canvas/read.ts`, `server/draw.ts` (result text) |
| T18 | `server/canvas-image.ts` | `ui/headless.tsx`, `ui/TldrawView.tsx`, `server/draw.ts` |
| T19 | `server/worktrees.ts`, `ui/page/WorktreeBadge.tsx` | `server/index.ts`, page toolbar |
| T20 | `test/**` | `package.json` |
| T21 | `scripts/e2e/**` | bug fixes where found |
| T30 | `ui/annotate/markdown.tsx` | `ui/MarkdownView.tsx` |
| T31 | `ui/ReviewTab.tsx`, `server/send.ts` | `app.tsx`, `server/index.ts` |
| T32 | `server/annotations-cli.ts` | `skills/project-space/SKILL.md` |
| T33 | `ui/annotate/tldraw.tsx` | `ui/TldrawView.tsx` |
| T34 | `ui/annotate/html-bridge.ts` | `ui/page/HtmlFrame.tsx` |

> [!NOTE] Known overlaps, all small
> T30 edits a different branch of `MarkdownView.tsx` than T12 and T16 did;
> T31 adds a fixed tab in `app.tsx` next to T14's.

## The shape of a brief

Every brief has the same sections, so an agent knows where to look:

| Section | Holds |
| --- | --- |
| lead and status callout | the goal in a sentence; merged, ready, or not started |
| *Read first* | pages and files to read before starting |
| *Do* | numbered steps |
| *Acceptance* | a task list the report has to answer |
| *Result* | what was built and measured, added at integration |
| *Out of scope*, *Docs* | what not to do; which space page to update |
