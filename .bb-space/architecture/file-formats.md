# File formats

| Extension | Opens as | Edited by |
|---|---|---|
| `.md`, `.markdown`, `.mdx` | Rendered document | Source + live preview |
| `.html`, `.htm` | Live page in a sandboxed iframe | Source + live preview |
| `.tldr` | tldraw canvas | tldraw, autosaved |
| `.png`, `.jpg`, `.gif`, `.webp`, `.avif`, `.svg` | Image | — |
| `.pdf` | Browser PDF viewer | — |
| anything else | Highlighted source | Source |

`.tldr` files use tldraw's own file format (`serializeTldrawJson`), so they
also open on [tldraw.com](https://tldraw.com). An empty `.tldr` is a blank
board; the first edit writes the format. Agents draw into them with
`space_draw` / `bb space draw` rather than writing the JSON.

Dot-prefixed files and folders are hidden from the tree. `.bb-space/.space/`
is reserved for the plugin's own bookkeeping (annotations, later).
