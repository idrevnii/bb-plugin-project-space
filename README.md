# Project Space

A bb plugin that gives every project a full-screen documentation **space** —
Markdown pages, browser-rendered HTML, and tldraw canvases that agents and
people edit together. A project's space is the `.bb-space/` folder in its
checkout.

The full documentation lives in this repository's own space:
[`.bb-space/index.md`](.bb-space/index.md) — open it in bb under **Space**.

## Install

```sh
npm install
bb plugin install .
```

## Layout

```
server/index.ts      plugin factory: settings, module list, one rpcContract
server/space.ts      project → space resolution, fs.watch → realtime
server/files.ts      space_* file RPC, `bb space root|init|tree`
server/draw.ts       draw queue, space_draw / space_canvas_read tools, `bb space draw|canvas`
server/cli.ts        `bb space` command: merges module commands, shared helpers
app.tsx              Space page (navPanel), Files tab, thread-header button, ::space directive
ui/page/             routing, project picker, toolbar, text / HTML / binary documents
ui/FileTree.tsx      tree with create / rename / delete
ui/MarkdownView.tsx  Markdown reader
ui/markdown-plugins  reader pipeline: callouts, ==highlight==, sanitized raw HTML
lib/callouts.ts      `> [!type]` callout markers, shared by reader and editor
ui/reading-style*    reading styles (Blue Topaz, Things) for reader and editor
themes/              bb themes: palette + chat Markdown look
ui/TldrawView.tsx    .tldr editor with CAS autosave
ui/data.ts           RPC hooks with live refresh
ui/canvas-apply.ts   spec → tldraw shapes      (ported from bb-plugin-canvas, MIT)
ui/headless.tsx      off-screen renderer for queued drawings
lib/canvas/          draw spec, auto-layout, .tldr → text
lib/space.ts         path rules shared by server and app
skills/project-space the skill agents receive
test/                unit tests (vitest)
scripts/e2e/         Playwright checks against a running bb
```

## Develop

```sh
npm run check    # typecheck + tests + build
bb plugin build && bb plugin reload project-space
npm run e2e      # browser checks against the installed plugin
```

See [`.bb-space/guides/developing.md`](.bb-space/guides/developing.md).

tldraw is bundled under the [tldraw license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md):
free on `http://` and localhost origins; other https origins need the
*tldraw license key* setting.

The *Reading style* setting and the **Blue Topaz** and **Things** themes
(Settings → Appearance) follow the Obsidian themes
[Blue Topaz](https://github.com/PKM-er/Blue-Topaz_Obsidian-css) and
[Things](https://github.com/colineckert/obsidian-things) (both MIT). The
themes' Markdown rules style bb's own DOM (`[data-markdown-preview]`), so a
bb update can break them.
