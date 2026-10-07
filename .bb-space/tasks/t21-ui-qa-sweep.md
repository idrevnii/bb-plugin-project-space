# T21 · UI QA sweep

Exercise the flows nobody has checked live yet and fix what breaks.

> [!todo] Not started
> Wave 1 · depends on: T00, T01. Both are merged, so it can start.

## Unverified so far

- [ ] Rename and delete in the tree (files and folders, including the open one).
- [ ] *File tree position* = `left`.
- [ ] The **Space** button in a thread header; the `::space` card in chat
      (`bb space link`) and its *Open in space*.
- [ ] The edit conflict banner: edit a page, change it on disk, save →
      *Discard mine* / *Overwrite*.
- [ ] Canvas conflict: draw while an agent rewrites the file.
- [ ] Non-UTF-8 and binary files, a 5 MB Markdown file, an empty space folder.
- [ ] A console warning on every page: *plugin "project-space" tried to move
      `<div>` out of React's tree* (likely the off-screen renderer in
      `ui/headless.tsx`); find the cause and remove it if it is ours.
- [ ] A `|` inside inline code in a table cell (written `\|` in the source)
      is saved unescaped by the WYSIWYG editor, which splits the cell. Found
      by `test/markdown-roundtrip.test.ts` while rewriting the docs; the
      space avoids the pattern for now.

## Do

One e2e script per flow under `scripts/e2e/`, then fix the bugs they expose
(smallest fix, in the file that owns the behavior).

## Acceptance

- [ ] Each flow has a script that passes; `npm run e2e` runs them.
- [ ] Report lists every bug found, fixed or not.
- [ ] `npm run check` passes.
