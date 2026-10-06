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
server.ts            RPC (space_*), fs.watch → realtime, `bb space` CLI, settings
app.tsx              Space page (navPanel), Files tab, thread-header button, ::space directive
ui/SpacePage.tsx     routing, project picker, document area, text editing, HTML frame
ui/FileTree.tsx      tree with create / rename / delete
ui/MarkdownView.tsx  Markdown reader
ui/TldrawView.tsx    .tldr editor with CAS autosave
ui/data.ts           RPC hooks with live refresh
ui/canvas-apply.ts   spec → tldraw shapes      (ported from bb-plugin-canvas, MIT)
ui/headless.tsx      off-screen renderer for queued drawings
lib/canvas/          draw spec, auto-layout, .tldr → text
lib/space.ts         path rules shared by server and app
skills/project-space the skill agents receive
```

## Develop

```sh
npm run typecheck
bb plugin build && bb plugin reload project-space
```

tldraw is bundled under the [tldraw license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md):
free on `http://` and localhost origins; other https origins need the
*tldraw license key* setting.
