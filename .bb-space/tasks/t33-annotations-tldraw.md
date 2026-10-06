# T33 · Annotate canvases

**Wave 2 · depends on: T10**

## Goal

Comment on shapes in a tldraw canvas.

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

- [ ] e2e: select two boxes → comment → reload → badge present; move the
      boxes → badge follows; delete them → orphaned.
- [ ] `bb space canvas` output shows the comment beside the node.
- [ ] `npm run check` passes.

## Docs

[Using the space](../guides/using-the-space.md) → *Annotations*.
