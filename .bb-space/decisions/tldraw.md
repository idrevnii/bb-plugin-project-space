# tldraw for canvases

Canvases are where architecture and flows get drawn, by people and by agents,
so the editor had to be both pleasant by hand and drivable from a spec.

**Decision.** Canvases are `.tldr` files edited with **tldraw**.

## Why

It is the best freeform editor available as a React component, its file
format is portable (the same file opens on tldraw.com), and
[bb-plugin-canvas](https://github.com/Borjampm/bb-plugin-canvas) had already
proved agent drawing tools on top of it that we could port — the spec,
layout and apply code in `lib/canvas/` and `ui/canvas-apply.ts` come from
there (MIT).

## Rejected

- **Excalidraw** (MIT) — no license constraint; kept as the fallback if
  tldraw's license becomes a problem.

## Consequences

> [!WARNING] tldraw's license limits https origins
> tldraw is free on `http://` and localhost origins. On any other https
> origin, for example bb connect, the editor hides itself without a key.

The page shows an explanation instead of mounting there, and the *tldraw
license key* setting takes a key when one is available. tldraw also runs only
in the browser, which is why agent drawing and canvas pictures go through a
queue that an open bb window works off — see
[architecture](../architecture/index.md#off-screen-tldraw-agent-drawing).
