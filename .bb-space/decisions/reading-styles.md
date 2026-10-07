# Reading styles from Obsidian themes

The look of a page decides if its format carries a meaning. A reader scans
colors and shapes before the sentences. This decision gives Markdown in the
space a designed look, not the neutral look of bb.

**Decision.** Space Markdown in the reader and in the WYSIWYG editor has a
*Reading style* setting: `blue-topaz` (default), `things` or `plain`. The
styles copy the Obsidian themes
[Blue Topaz](https://github.com/PKM-er/Blue-Topaz_Obsidian-css) and
[Things](https://github.com/colineckert/obsidian-things) (both MIT). The
plugin also adds two bb themes with the same names.

## Why

The styles give each heading level its own color. They also give bold,
italic, inline code, highlights, quotes, callouts, lists and tables each
their own look. Thus each mark becomes a signal that a reader can scan for.
This makes the writing rules of the agent skill (*Write for a reader*)
useful. Two well-known Obsidian themes give people a look that they possibly
know already.

The bb themes (Settings → Appearance → **Blue Topaz** or **Things**) give
agent replies and file previews the same Markdown look. Thus a page and a
chat answer look the same.

## Consequences

- The style is set on the element around the document, as
  `data-reading-style`. [`ui/reading-style.ts`](../../ui/reading-style.ts)
  reads the setting. `ui/reading-styles/` holds the CSS. Its `elements.css`
  styles callouts, highlights and footnotes in each style.
- The meaning must also be clear in the `plain` style. Color only makes
  stronger what the Markdown mark already says.

> [!WARNING] Check the bb themes after a bb update
> Their Markdown rules (`themes/*.css`) target the
> `[data-markdown-preview]` DOM of bb, not a theme API. A bb update can
> break them.
