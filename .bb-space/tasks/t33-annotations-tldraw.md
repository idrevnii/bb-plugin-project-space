# T33 · Annotate canvases

Comment on shapes in a tldraw canvas.

> [!success] Done 2026-10-07
> Wave 2 · depends on: T10. Documented in [Using the space → Comments on a canvas](../guides/using-the-space.md#on-a-canvas)
> and [Annotations → Canvases](../architecture/annotations.md#canvases).

## Read first

- `ui/TldrawView.tsx`, `lib/annotations.ts`

## Do

1. With shapes selected, a *Comment* action (tldraw toolbar/context menu
   override, or a floating button over the selection bounds) creates an
   annotation with `{ kind: "shapes", shapeIds }`.
2. Markers: a small numbered badge pinned to the top-right of each annotated
   selection's bounds (tldraw `InFrontOfTheCanvas` component), following the
   camera; click opens the comment (edit, delete, resolve).
3. Annotations whose shapes are all deleted show as orphaned in a corner list.
4. `lib/canvas/read.ts`: include annotation comments next to the shapes they
   point at when describing a canvas, so agents see them.

## Acceptance

- [x] e2e: select two boxes → comment → reload → badge present; move the
      boxes → badge follows; delete them → orphaned.
- [x] `bb space canvas` output shows the comment beside the node.
- [x] `npm run check` passes.

## Notes

- Code: [`ui/annotate/tldraw.tsx`](../../ui/annotate/tldraw.tsx) (button,
  context-menu item, badges, corner list), wired in
  [`ui/TldrawView.tsx`](../../ui/TldrawView.tsx); comments in the text an
  agent reads in [`lib/canvas/read.ts`](../../lib/canvas/read.ts), fed by
  [`server/draw.ts`](../../server/draw.ts). Checked by
  `test/canvas-read.test.ts`, `test/annotations-agent.test.ts` and
  `scripts/e2e/annotations-canvas.mjs`.
- The comment editor and card moved from `ui/annotate/markdown.tsx` to
  [`ui/annotate/comment.tsx`](../../ui/annotate/comment.tsx), shared by both
  annotators.
- Both *Comment* entry points are built: a button under the selection and
  an item in tldraw's context menu.
- Clicking a canvas comment in the Review tab centers the board on its
  shapes and opens it.
- Resolved comments are only counted in `bb space canvas`, to keep the
  description short.

## Docs

[Using the space](../guides/using-the-space.md) → *Annotations*.
