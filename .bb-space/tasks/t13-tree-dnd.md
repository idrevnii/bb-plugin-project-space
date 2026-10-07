# T13 · Drag and drop in the file tree

Move files and folders by dragging them in the Files tree.

> [!success] Merged 2026-10-07
> Wave 1 · depends on: T01. Documented now in [Using the space → Move files](../guides/using-the-space.md#move-files).

## Read first

- `ui/FileTree.tsx` (rename already uses `space_move`)

## Do

1. Native HTML5 drag and drop on tree rows: drop on a folder moves into it,
   drop on the empty area below the tree moves to the space root. Highlight
   the drop target; auto-expand a folder after hovering it ~600 ms.
2. Refuse moving a folder into itself or its descendants, and onto an
   existing name (toast, like rename).
3. If the open file (or a folder containing it) moves, navigate to its new
   path, as rename does.
4. Keyboard alternative: a *Move to…* row action with a folder picker.

## Acceptance

- [ ] e2e: drag a page into a folder and back; drag a folder; the open
      document follows; an illegal drop is refused.
- [ ] Does not start a bb split drag (the sidebar's split gesture) — check
      by dragging within the panel.
- [ ] `npm run check` passes.

## Out of scope

Reordering (order stays alphabetical with `index` first).

## Docs

[Using the space](../guides/using-the-space.md) → *Files*.
