# For agents

The plugin ships a `project-space` skill; this page is the short version.

```sh
bb space root    # absolute path of the live space
bb space init    # create it with index.md if missing
bb space tree    # list what is there
bb space search annotations   # find pages by name, then by text inside
bb space link architecture/index.md --title "Architecture"   # chat card
bb space draw architecture/diagram.tldr --spec-file spec.json  # diagram
bb space canvas architecture/diagram.tldr                      # read it back
bb space canvas architecture/diagram.tldr --png /tmp/d.png     # see it as a PNG
```

`bb space search` prints name matches first (one path per line), then text
hits as `path:line: snippet` (canvas hits name the matching shape label, with
no line). Any case, at most three hits per file, 50 results and about two
seconds in all; a last line says when more were cut. `--json` gives
`{ results: [{ path, kind, line?, snippet? }], truncated }`, `--limit` fewer.
Search before writing a page so you extend the one that exists.

In new threads the same drawing is available as the `space_draw`,
`space_canvas_read` and `space_canvas_view` tools. `space_canvas_view` returns
a PNG of the canvas (light theme, at most 1600 px wide) so you can check a
drawing the way the user sees it. tldraw only runs in the browser, so the
picture comes from an open bb window: every save posts one, and a stale one is
re-rendered on request. With no window open the tool answers within 12 s that
it could not render, rather than hanging. Pictures live in the plugin's
database, never in `.bb-space/`.

Write files at `bb space root` with ordinary tools. In a worktree that path is
the main checkout, so the user sees changes at once.

- Keep `index.md` as the front page and link every new page from it.
- One topic per page, folders by topic, relative links between pages.
- Link to code with relative paths too: from `guides/x.md`,
  `[entry](../../server/index.ts#L10)` (or `#L10-L24`) opens the file in bb's
  preview with those lines highlighted. A link that climbs above the checkout
  stays plain text. `/src/app.ts` also means the checkout root, unless the
  space has that file.
- Markdown by default; HTML for visual or interactive reports; `.tldr`
  canvases for diagrams, drawn with `space_draw` — never hand-written JSON.
