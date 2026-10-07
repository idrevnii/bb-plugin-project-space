# tldraw for canvases

People and agents draw architecture and flows on canvases. Thus the editor
must be easy to use by hand, and an agent must be able to draw on it from a
spec.

**Decision.** Canvases are `.tldr` files, and **tldraw** edits them.

## Why

tldraw is the best freeform editor that is available as a React component.
Its file format is portable: the same file opens on tldraw.com. Also,
[bb-plugin-canvas](https://github.com/Borjampm/bb-plugin-canvas) already
had agent drawing tools for tldraw that we could port (MIT). The spec,
layout and apply code in `lib/canvas/` and `ui/canvas-apply.ts` come from
there.

## Rejected

- **Excalidraw** (MIT) — it has no license limit. It is the fallback if the
  tldraw license becomes a problem.

## Consequences

> [!WARNING] Set a license key for https addresses
> tldraw is free on `http://` and localhost addresses. On all other https
> addresses, for example bb connect, the editor hides itself if there is no
> key.

On such an address, the Space screen shows an explanation and does not start
tldraw. The *tldraw license key* setting takes a key when you have one.

tldraw also runs only in the browser. Thus agent drawing and canvas pictures
go through a queue, and an open bb window does the work. See
[architecture](../architecture/index.md#off-screen-tldraw-agent-drawing).
