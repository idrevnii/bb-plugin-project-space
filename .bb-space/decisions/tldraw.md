# tldraw for canvases

**Decision.** Canvases are `.tldr` files edited with tldraw.

**Why.** It is the best freeform editor available as a React component, the
file format is portable, and [bb-plugin-canvas](https://github.com/Borjampm/bb-plugin-canvas)
already proved agent drawing tools on top of it that we can port.

**Trade-off.** tldraw's license: free on `http://` and localhost origins;
on any other https origin (for example bb connect) the editor hides itself
without a key. The page shows an explanation instead of mounting, and the
*tldraw license key* setting takes a key when one is available. Excalidraw
(MIT) is the fallback if this becomes a problem.
