# Reading styles after Obsidian themes

How a space page looks decides whether formatting carries meaning: a reader
skims by colors and shapes long before reading sentences. This decision gives
Markdown in the space a designed look instead of bb's neutral one.

**Decision.** Space Markdown, in the reader and the WYSIWYG editor, takes a
*Reading style* setting — `blue-topaz` (default), `things` or `plain` —
modeled on the Obsidian themes
[Blue Topaz](https://github.com/PKM-er/Blue-Topaz_Obsidian-css) and
[Things](https://github.com/colineckert/obsidian-things) (both MIT). The
plugin also contributes two bb themes of the same names.

## Why

The styles color headings by level and give bold, italic, inline code,
highlights, quotes, callouts, lists and tables each their own look, so every
mark becomes a signal a reader can scan for. That is what makes the writing
rules in the agent skill (*Write for a reader*) pay off. Following two
well-known Obsidian themes gives people a look they may already read fluently.

The bb themes (Settings → Appearance → **Blue Topaz** or **Things**) carry
the same Markdown look into agent replies and file previews, so a page and a
chat answer read alike.

## Consequences

- The style is set on the element wrapping the document as
  `data-reading-style`; [`ui/reading-style.ts`](../../ui/reading-style.ts)
  reads the setting and `ui/reading-styles/` holds the CSS, including
  `elements.css` for callouts, highlights and footnotes in every style.
- Meaning must survive `plain` too: color only reinforces what the Markdown
  mark already says.

> [!WARNING] The bb themes can break on a bb update
> Their Markdown rules (`themes/*.css`) target bb's own
> `[data-markdown-preview]` DOM rather than a theme API.
