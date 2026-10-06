# T11 · WYSIWYG Markdown editing

**Wave 1 · depends on: T01**

## Goal

Edit Markdown in place, looking like the reader, instead of a source pane.
Keep a *Source* toggle for raw editing.

## Read first

- [Using the space](../guides/using-the-space.md)
- `ui/page/TextDocument.tsx`, `ui/MarkdownView.tsx` (typography to match)
- bb's built-in Docs plugin uses TipTap; follow that direction.

## Do

1. `ui/page/MarkdownEditor.tsx`: TipTap with StarterKit, tables, task lists,
   links, code blocks, images (relative paths resolved through the preview
   URL like the reader), and Markdown in/out (e.g. `tiptap-markdown` or
   `@tiptap/pm` + a markdown serializer).
2. In `TextDocument`, Markdown files edit with it by default; a *Source*
   toggle swaps to the existing textarea. Save, `Ctrl/⌘+S`, conflict banner
   and compare-and-swap stay exactly as they are.
3. Style with the same token classes as `MarkdownView` so editing does not
   jump visually.

## Acceptance

- [ ] **Round trip:** for every `.md` in this space, load → serialize without
      edits produces text whose rendered output is identical (test in
      `test/markdown-roundtrip.test.ts`; whitespace-only differences allowed,
      list markers/escapes must not be mangled).
- [ ] Editing a table cell, ticking a task, adding a link and saving all
      persist correctly (e2e script).
- [ ] Bundle growth reported in your summary.
- [ ] `npm run check` passes.

## Out of scope

Collaborative/realtime co-editing; slash commands.

## Docs

Update [Using the space](../guides/using-the-space.md) → *Reading and editing*.
