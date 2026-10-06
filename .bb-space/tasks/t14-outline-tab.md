# T14 · Outline tab

**Wave 1 · depends on: T01**

## Goal

A second fixed tab in the right panel, *Outline*, listing the headings of the
open Markdown page, so long documents are navigable.

## Read first

- `app.tsx` (how the *Files* fixed tab is registered), `ui/page/FilesTab.tsx`
- `ui/MarkdownView.tsx` (headings get ids from `rehype-slug`)

## Do

1. `ui/OutlineTab.tsx`, registered as a second fixed tab
   (`{ panelId: "space", id: "outline" }`, icon `ListView`, `layout: "flush"`).
   It reads the route from `subPath` like the Files tab and the file through
   `useSpaceFile`.
2. Build the heading list from the Markdown source with the same slugger
   `rehype-slug` uses (`github-slugger`), so ids match the rendered page.
3. Click scrolls the page to the heading; the heading currently at the top of
   the reader is highlighted (IntersectionObserver in the page, shared via a
   small module-level store keyed by project+path).
4. Non-Markdown files: a short "No outline for this file" message.

## Acceptance

- [ ] e2e: on `roadmap.md` the outline lists its headings; clicking one
      scrolls to it; scrolling the page moves the highlight.
- [ ] `npm run check` passes.

## Out of scope

Outline for HTML or canvases.

## Docs

[Using the space](../guides/using-the-space.md): mention the Outline tab.
