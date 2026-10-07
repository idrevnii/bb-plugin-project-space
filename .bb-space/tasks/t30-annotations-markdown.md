# T30 · Annotate Markdown pages

Select text in a rendered Markdown page, write a comment, see it highlighted.

> [!success] Done 2026-10-07
> Wave 2 · depends on: T10. Documented in [Using the space → Annotations](../guides/using-the-space.md#comment-on-a-page-or-a-canvas)
> and [Annotations → Markdown pages](../architecture/annotations.md#markdown-pages).

## Read first

- [Annotations architecture](../architecture/annotations.md) (from T10),
  `lib/annotations.ts`
- `ui/MarkdownView.tsx`

## Do

1. `ui/annotate/markdown.tsx`: on a non-empty selection inside the reader, a
   small floating *Comment* button; it opens a popover with a textarea
   (`Ctrl/⌘+Enter` saves). Build the anchor with `quoteSelector` against the
   page's **rendered text** (the article's `textContent`), not the source.
2. Highlights: after render, locate each annotation with `locateQuote` on the
   rendered text and wrap the range with the CSS Custom Highlight API
   (`CSS.highlights`, no DOM mutation); fall back to `<mark>` wrapping only if
   unsupported. Orphaned annotations are listed under the page title.
3. Clicking a highlight opens the comment: edit, delete, mark resolved.
4. Live: refetch on `space-annotations-changed`.

## Acceptance

- [x] e2e: annotate a phrase, reload — highlight is there; edit the page so
      the phrase moves — still highlighted; delete the phrase — listed as
      orphaned.
- [x] Selecting text in edit mode does not offer *Comment*.
- [x] `npm run check` passes.

## Out of scope

The review list and sending (T31); HTML (T34).

## Docs

[Using the space](../guides/using-the-space.md) → *Annotations*.
