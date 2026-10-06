# T21 · UI QA sweep

**Wave 1 · depends on: T00, T01**

## Goal

Exercise the flows nobody has checked live yet and fix what breaks.

## Unverified so far

- Rename and delete in the tree (files and folders, including the open one).
- *File tree position* = `left`.
- The **Space** button in a thread header; the `::space` card in chat
  (`bb space link`) and its *Open in space*.
- The edit conflict banner: edit a page, change it on disk, save →
  *Discard mine* / *Overwrite*.
- Canvas conflict: draw while an agent rewrites the file.
- Non-UTF-8 and binary files, a 5 MB Markdown file, an empty space folder.
- A console warning on every page: *plugin "project-space" tried to move
  `<div>` out of React's tree* (likely the off-screen renderer in
  `ui/headless.tsx`); find the cause and remove it if it is ours.

## Do

One e2e script per flow under `scripts/e2e/`, then fix the bugs they expose
(smallest fix, in the file that owns the behavior).

## Acceptance

- [ ] Each flow has a script that passes; `npm run e2e` runs them.
- [ ] Report lists every bug found, fixed or not.
- [ ] `npm run check` passes.
