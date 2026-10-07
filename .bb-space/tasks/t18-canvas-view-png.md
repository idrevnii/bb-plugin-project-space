# T18 · Let agents see a canvas (PNG)

`space_canvas_view` returns a picture of a canvas, so an agent can check its
drawing the way the user sees it.

> [!success] Merged 2026-10-07
> Wave 1 · depends on: T01. Documented now in [Architecture → canvas pictures](../architecture/index.md#plugin-sqlite-canvas-pictures).

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

- [x] Calling the tool right after `space_draw` returns an image of the new
      drawing (report how you checked it).
- [x] With no bb window open it answers within 12 s with a clear message,
      not a hang.
- [x] `npm run check` passes.

## Result (2026-10-07)

- `server/canvas-image.ts`: table `canvas_images` (appended to draw.ts's
  migrations) keeps the latest PNG per project + path with the file sha it
  was rendered from. `space_canvas_view` returns it when the sha matches the
  file; otherwise it queues a render-only batch (spec `{}`, same queue as
  drawing), pings `space-draw`, and polls for up to 12 s. A request nobody
  answered is removed. Missing and empty canvases answer at once.
- `bb space canvas <path> --png <out.png>` writes the picture on the machine
  that ran `bb`; a path with a `.bb-space` segment is refused.
- `ui/canvas-image.ts` exports the page with `editor.toImage` (png,
  background, padding 32, light theme, scaled to at most 1600 px wide and
  2400 px tall). The open canvas posts after every save; the off-screen
  renderer posts after each write, before acking, and answers render-only
  batches at once without writing the file. An open canvas whose file was
  rewritten underneath it leaves the request to the off-screen renderer.
- The `space_draw` result ends with a pointer to `space_canvas_view`.
- Checked: the real `space_draw` tool, then `bb space canvas --png` right
  after it (0.3 s) gave a picture of the new drawing. `space_canvas_view`
  itself was not callable from the integrating thread (it registered after
  the thread started); its output format and the 12 s timeout message are
  unit-tested (`test/canvas-image.test.ts`, fake timers). The no-window case
  was not reproduced live, since a bb window was open.
- E2E: `scripts/e2e/canvas-view.mjs` (off-screen, stale-after-hand-edit, open
  canvas); pictures in `scripts/e2e/out/canvas-view-*.png`.

### Fixes after review (@thread:thr_nndgyrd4x9)

- `--png` is checked after the path is resolved: a relative path from inside
  `.bb-space/`, `..`, and (on the space's own host) symlinks into the space
  are refused.
- A file tldraw cannot load is reported ("cannot be pictured: …"), no longer
  stored as a blank picture: renderers post an `error` with the sha.
- A render-only request is acked only once its answer reached the server; a
  view re-queues whenever no request is waiting (covers a lost picture and a
  request withdrawn by a parallel view that gave up).
- The open canvas posts only if the board still matches the file after the
  export, so unsaved edits never go out under the file's sha.
- A view of a missing canvas drops its stored picture; pictures not
  refreshed for 30 days are pruned at load.

## Out of scope

Image annotations; PNG export into the space.

## Docs

Skill and [for agents](../guides/for-agents.md).
