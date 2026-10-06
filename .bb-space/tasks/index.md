# Tasks

The [roadmap](../roadmap.md) cut into briefs an agent can take alone. Each
brief says what to build, which files it owns, and how to prove it works.

**Dependency map:** [tasks.tldr](tasks.tldr)

## Waves

| Wave | Runs | Tasks |
|---|---|---|
| 0 | one after another, one agent | [T00](t00-repo-baseline.md) → [T01](t01-split-modules.md) |
| 1 | in parallel, after T01 | [T10](t10-annotations-core.md) · [T11](t11-wysiwyg-markdown.md) · [T12](t12-mermaid.md) · [T13](t13-tree-dnd.md) · [T14](t14-outline-tab.md) · [T15](t15-space-search.md) · [T16](t16-outside-links.md) · [T17](t17-canvas-lint.md) · [T18](t18-canvas-view-png.md) · [T19](t19-worktree-awareness.md) · [T20](t20-unit-tests.md) · [T21](t21-ui-qa-sweep.md) |
| 2 | in parallel, after T10 | [T30](t30-annotations-markdown.md) · [T31](t31-annotations-review-tab.md) · [T32](t32-annotations-agent-api.md) · [T33](t33-annotations-tldraw.md) · [T34](t34-annotations-html.md) |

Wave 0 exists so wave 1 can run without merge pain: today `server.ts` and
`ui/SpacePage.tsx` hold almost everything, and the directory is not a git
repository yet, so there are no worktrees.

## Status

Updated 2026-10-07. "Merged" means in `main` with `npm run check` green.

| Task | State |
|---|---|
| T00, T01 | merged |
| T10 | merged |
| T11 | merged |
| T12 | merged |
| T13 | merged |
| T14 | merged |
| T15 | merged |
| T16 | not started |
| T17 | merged |
| T18 | in progress, uncommitted in its worktree |
| T19 | not started |
| T20 | in progress, uncommitted in its worktree |
| T21 | not started |
| T30–T34 | waiting for wave 2 (T10 is merged, so they can start) |

## Who touches what

| Task | Owns (creates or mainly edits) | Also touches (small, additive) |
|---|---|---|
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

Known overlaps: T12/T16/T30 edit different branches of `MarkdownView.tsx`;
T17/T18 both add a line to the draw result in `server/draw.ts`; T14/T31 each
add one fixed tab in `app.tsx`. All are small, additive merges.

## Rules for every task

1. **Work in your own worktree**, on branch `task/<id>`. Keep the diff inside
   the files your brief owns; if you must touch another, keep it additive and
   say so in your report.
2. **Verify locally:** `npm run typecheck`, `npm test`, `bb plugin build`.
   UI tasks also add or extend a script under `scripts/e2e/` that exercises
   the feature.
3. **Do not run `bb plugin install` or `bb plugin reload` from a worktree.**
   The installed plugin points at the main checkout; reinstalling from a
   worktree swaps it out under every other agent. Live checks happen at
   integration, one branch at a time, with the e2e scripts.
4. **Docs:** update or add the space page your brief names. Do not edit
   `roadmap.md` or this index; the integrator does.
5. **Report:** what changed (files), how you verified it, anything left
   undone, and screenshots for UI.

## Integrating

Merge in wave order. After each merge, in the main checkout:
`bb plugin build && bb plugin reload project-space`, run `npm run e2e`, then
tick the roadmap.
