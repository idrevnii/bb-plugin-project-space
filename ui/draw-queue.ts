// Applying queued drawing batches to a tldraw editor. Shared by the open
// canvas (TldrawView) and the off-screen renderer (headless.tsx).
import { allDefaultFontFaces, type Editor } from "tldraw";
import type { DrawBatch } from "../server";
import { RENDER_ONLY_SPEC, drawSpecSchema } from "../lib/canvas/spec";
import { applyDrawSpec } from "./canvas-apply";

/**
 * Label boxes are measured with the loaded font; measuring with a fallback
 * leaves them too small for the real one.
 */
export async function waitForFonts(editor: Editor): Promise<void> {
  await Promise.allSettled(
    allDefaultFontFaces.map((font) => editor.fonts.ensureFontIsLoaded(font)),
  );
}

/**
 * Applies batches in order and returns every id that is now done with,
 * including malformed batches, which are skipped rather than retried forever.
 */
export function applyBatches(editor: Editor, batches: readonly DrawBatch[]): number[] {
  const done: number[] = [];
  for (const batch of batches) {
    try {
      applyDrawSpec(editor, drawSpecSchema.parse(JSON.parse(batch.spec)));
    } catch (cause) {
      console.warn(`project-space: skipped drawing batch ${batch.id}`, cause);
    }
    done.push(batch.id);
  }
  return done;
}

/** Render-only batches ask for a picture and draw nothing. */
export function isRenderOnly(batch: DrawBatch): boolean {
  return batch.spec === RENDER_ONLY_SPEC;
}
