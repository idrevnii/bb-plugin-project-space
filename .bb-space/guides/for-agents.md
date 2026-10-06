# For agents

The plugin ships a `project-space` skill; this page is the short version.

```sh
bb space root    # absolute path of the live space
bb space init    # create it with index.md if missing
bb space tree    # list what is there
bb space link architecture/index.md --title "Architecture"   # chat card
bb space draw architecture/diagram.tldr --spec-file spec.json  # diagram
bb space canvas architecture/diagram.tldr                      # read it back
```

In new threads the same drawing is available as the `space_draw` and
`space_canvas_read` tools.

Write files at `bb space root` with ordinary tools. In a worktree that path is
the main checkout, so the user sees changes at once.

- Keep `index.md` as the front page and link every new page from it.
- One topic per page, folders by topic, relative links between pages.
- Markdown by default; HTML for visual or interactive reports; `.tldr`
  canvases for diagrams, drawn with `space_draw` — never hand-written JSON.
