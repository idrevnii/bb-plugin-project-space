// Pictures of canvases for agents (server/canvas-image.ts). Renderers export
// the page as a PNG after they save, and when a render-only batch asks for
// one, and post it with the sha of the file it shows.
import type { Editor } from "tldraw";

/** Wide enough to read labels, small enough for a model's image input. */
const MAX_WIDTH = 1600;
const MAX_HEIGHT = 2400;
const PADDING = 32;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("could not read the PNG"));
    reader.readAsDataURL(blob);
  });
}

/** The current page as base64 PNG, or "" when it has no shapes. */
export async function exportCanvasPng(editor: Editor): Promise<string> {
  const ids = [...editor.getCurrentPageShapeIds()];
  const bounds = editor.getCurrentPageBounds();
  if (ids.length === 0 || bounds === undefined) return "";
  const scale = Math.min(
    1,
    MAX_WIDTH / (bounds.w + 2 * PADDING),
    MAX_HEIGHT / (bounds.h + 2 * PADDING),
  );
  const { blob } = await editor.toImage(ids, {
    format: "png",
    background: true,
    padding: PADDING,
    scale,
    pixelRatio: 1,
    // Always light, so a picture does not depend on whose window drew it.
    darkMode: false,
  });
  return blobToBase64(blob);
}

type ImagePut = (input: {
  projectId: string;
  path: string;
  sha256: string;
  pngBase64: string;
  error?: string;
}) => Promise<unknown>;

/**
 * Exports and posts a picture of `path` as of file `sha256`; true when the
 * server has it. Never throws: a missing picture only means the next view
 * asks for a fresh one. `stillCurrent` is checked after the export, so a
 * board edited meanwhile is not posted under the file's sha.
 */
export async function postCanvasImage(
  put: ImagePut,
  editor: Editor,
  target: { projectId: string; path: string; sha256: string },
  stillCurrent: () => boolean = () => true,
): Promise<boolean> {
  try {
    const pngBase64 = await exportCanvasPng(editor);
    if (!stillCurrent()) return false;
    await put({ ...target, pngBase64 });
    return true;
  } catch (cause) {
    console.warn(`project-space: could not post a picture of ${target.path}`, cause);
    return false;
  }
}

/** Tells the server the file at `sha256` cannot be pictured, and why. */
export async function postCanvasError(
  put: ImagePut,
  target: { projectId: string; path: string; sha256: string },
  error: string,
): Promise<boolean> {
  try {
    await put({ ...target, pngBase64: "", error });
    return true;
  } catch (cause) {
    console.warn(`project-space: could not report ${target.path} as unreadable`, cause);
    return false;
  }
}
