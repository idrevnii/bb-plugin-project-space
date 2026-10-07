# File formats

This page tells what each file in a space opens as. It also lists the
Markdown syntax that the reader knows in addition to plain GFM. Use it to
look things up. How the reader is built is in [architecture](index.md).

## What opens as what

| Extension | Opens as | Edited with |
| --- | --- | --- |
| `.md`, `.markdown`, `.mdx` | a rendered document | the page itself (WYSIWYG), or *Source* with a live preview |
| `.html`, `.htm` | a live page in a sandboxed iframe | the source, with a live preview |
| `.tldr` | a tldraw canvas | tldraw, with autosave |
| `.png`, `.jpg`, `.gif`, `.webp`, `.avif`, `.svg` | an image | — |
| `.pdf` | the PDF viewer of the browser | — |
| all other extensions | highlighted source | the source |

`.tldr` files use the format of tldraw (`serializeTldrawJson`), so they also
open on [tldraw.com](https://tldraw.com). An empty `.tldr` file is an empty
canvas, and the first edit writes the format. Agents draw into canvases with
`space_draw` or `bb space draw`. They never write the JSON.

> [!NOTE] Hidden files
> The tree does not show files and folders whose name starts with a dot.
> `.bb-space/.space/` is for the plugin's own data. Today, this is
> [annotations](annotations.md).

## Markdown in addition to GFM

Pages are GitHub-flavored Markdown: tables, task lists, strikethrough,
footnotes and autolinks. The reader also knows the syntax that GitHub and
Obsidian readers know:

| Syntax | Renders as |
| --- | --- |
| `> [!NOTE]` … `> [!CAUTION]` | a GitHub alert: a colored callout with an icon |
| `> [!info] Title`, `> [!bug]- Title` | an Obsidian callout with its own title; `-` makes it start folded, `+` makes it foldable but open |
| `==text==` | a highlight (`<mark>`) |
| `[^1]` and `[^1]: …` | a footnote; the notes go to the end of the page |
| `<kbd>`, `<mark>`, `<details>`/`<summary>`, `<sub>`, `<sup>`, … | the HTML element |

Each callout type gets one of the five GitHub colors:

| Color | Types |
| --- | --- |
| *note* (blue) | `note`, `info`, `todo`, `abstract`, `summary`, `tldr`, and all unknown types |
| *tip* (green) | `tip`, `hint`, `success`, `check`, `done` |
| *important* (violet) | `important`, `question`, `help`, `faq`, `example` |
| *warning* (orange) | `warning`, `attention` |
| *caution* (red) | `caution`, `danger`, `error`, `failure`, `bug`, `missing` |
| grey | `quote`, `cite` |

The parser is in [lib/callouts.ts](../../lib/callouts.ts). The reader and
the editor both use it. The reader's plugins are in
[ui/markdown-plugins.ts](../../ui/markdown-plugins.ts).

> [!WARNING] Write an HTML page for styled content
> The reader sanitizes raw HTML. Only the GitHub allowlist and `<mark>` stay.
> It removes scripts, `style`, event handlers and `javascript:` links. Ids
> from footnotes and raw HTML get the prefix `user-content-`. In-page `#`
> links find them with or without the prefix.

## Mermaid diagrams

A fenced `mermaid` block renders as a diagram in the light or dark theme of
bb. When the theme changes, the diagram renders again. Here is an example.
To see the fence, open *Source*.

```mermaid
flowchart LR
  agent([Agent]) -->|writes| space[(.bb-space/)]
  space --> reader[Space reader]
  reader -->|you comment| agent
```

- **All diagram types** of mermaid work: `sequenceDiagram`, `classDiagram`,
  `stateDiagram-v2`, `erDiagram`, `gantt`, and others.
- **Strict security** — with `securityLevel: "strict"`, the reader sanitizes
  HTML in labels and ignores `click` directives.
- **Parse errors** — the error line of mermaid shows above the source of the
  diagram.
- **Load time** — the Space screen bundles mermaid but starts it only when a
  page first has a diagram.
