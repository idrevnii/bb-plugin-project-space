# T18 · Let agents see a canvas (PNG)

**Wave 1 · depends on: T01**

## Goal

`space_canvas_view` returns a picture of a canvas, so an agent can check its
drawing the way the user sees it.

## Read first

- `ui/headless.tsx`, `ui/TldrawView.tsx`, `server/draw.ts`
- Original design: bb-plugin-canvas `canvas_view` and `persist.ts` (MIT)

## Do

1. Renderers (open canvas after save, headless after applying) export a PNG
   with `editor.toImage(..., { format: "png", background: true, padding: 32 })`,
   capped around 1600 px wide, and post it with
   RPC `space_canvas_image_put({ projectId, path, sha256, pngBase64 })`.
2. `server/canvas-image.ts`: store the latest image per project+path in the
   plugin SQLite with the file sha it was rendered from.
3. Tool `space_canvas_view({ path })`: if the stored image's sha matches the
   file, return it as image content; otherwise queue a *render-only* request
   (same queue as drawing, with an empty spec) and wait up to 12 s.
   Also `bb space canvas <path> --png <out.png>`.
4. Never write the PNG into `.bb-space/`.

## Acceptance

- [ ] Calling the tool right after `space_draw` returns an image of the new
      drawing (report how you checked it).
- [ ] With no bb window open it answers within 12 s with a clear message,
      not a hang.
- [ ] `npm run check` passes.

## Out of scope

Image annotations; PNG export into the space.

## Docs

Skill and [for agents](../guides/for-agents.md).
