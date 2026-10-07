# For agents

What an agent can do with a project's space: the `bb space` commands, the
drawing tools, and the rules for writing pages. The plugin ships these rules
as the `project-space` skill ([SKILL.md](../../skills/project-space/SKILL.md));
this page is the short version.

> [!IMPORTANT] Write where `bb space root` points
> Write files there with ordinary tools. In a worktree that path is the main
> checkout, so the user sees changes at once.

## Commands

| Command | Does |
| --- | --- |
| `bb space root` | prints the absolute path of the live space; creates nothing |
| `bb space init` | creates the space with an `index.md` if missing |
| `bb space tree` | lists what is there |
| `bb space search <text>` | finds pages by name, then by text inside |
| `bb space link <path> --title "…"` | prints a `::space` directive that shows the page as a card in chat |
| `bb space draw <path.tldr> --spec-file spec.json` | draws a boxes-and-arrows diagram |
| `bb space canvas <path.tldr>` | reads a canvas back as text |
| `bb space canvas <path.tldr> --png /tmp/d.png` | saves a PNG of the canvas, as the user sees it |

### Search output

`bb space search` prints name matches first, one path per line, then text
hits as `path:line: snippet`; canvas hits name the matching shape label, with
no line.

| Limit | Value |
| --- | --- |
| case | ignored |
| hits per file | 3 |
| results | 50 (`--limit` for fewer) |
| time | about 2 s, then a last line says more were cut |
| `--json` | `{ results: [{ path, kind, line?, snippet? }], truncated }` |

> [!TIP] Search before you write
> Extend the page that exists rather than adding a near-duplicate.

## Tools

In new threads the same drawing is available as agent tools.

| Tool | Does |
| --- | --- |
| `space_draw` | draws or updates a diagram from a spec; the result ends with an *Overlaps* section to fix |
| `space_canvas_read` | the canvas as text: nodes, arrows, text, hand-drawn shapes |
| `space_canvas_view` | a PNG of the canvas (light theme, at most 1600 px wide) |

tldraw runs only in the browser, so pictures come from an open bb window:
every save posts one, and a stale one is re-rendered on request. ==With no
window open, `space_canvas_view` answers within 12 s that it could not
render==; fall back to `space_canvas_read`. Pictures live in the plugin's
database, never in `.bb-space/`.

## Rules for pages

- **Front page** — keep `index.md` short and link every new page from it.
- **Organization** — one topic per page, folders by topic, lowercase-kebab
  names, relative links between pages.
- **Links to code** — relative paths too: from `guides/x.md`,
  `[entry](../../server/index.ts#L10)` (or `#L10-L24`) opens the file in bb's
  preview with those lines highlighted. A link that climbs above the checkout
  stays plain text; `/src/app.ts` means the checkout root unless the space
  has that file.
- **Formats** — Markdown by default; HTML for visual or interactive reports;
  `.tldr` canvases for diagrams, drawn with `space_draw`, never hand-written
  JSON. Small diagrams tied to the text go inline as ` ```mermaid ` blocks.
- **Formatting** — every mark is a signal in the reading styles, so each gets
  one job: **bold** for the thing to remember, *italic* for a new term,
  `code` for anything literal, ==highlight== for what changed, callouts
  colored by what the reader should do, tables for items that share
  attributes. The skill's *Write for a reader* section has the full rules.
