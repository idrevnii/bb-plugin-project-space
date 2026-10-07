// Canvas pictures: the `space_canvas_view` agent tool, the
// `space_canvas_image_put` RPC renderers post PNGs with, and the picture
// behind `bb space canvas <path> --png <out.png>`.
//
// tldraw renders in the browser, so the server keeps the latest PNG per
// canvas in the plugin database (table `canvas_images`, created by draw.ts's
// migrations), tagged with the sha of the file it was drawn from. Renderers
// post one after every save (ui/canvas-image.ts). A view whose stored picture
// is stale queues a render-only batch — an empty spec in the drawing queue —
// and waits for a renderer to answer it. Pictures never go into `.bb-space/`.
import { PluginCliError, defineRpcContract, type BbPluginApi, type PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { RENDER_ONLY_SPEC } from "../lib/canvas/spec";
import { fileKind } from "../lib/space";
import { writeInvokerFile } from "./cli";
import { defineModule, type ServerContext } from "./context";
import { absolute, nonRootSpacePath, projectId, type ProjectSpace } from "./space";

/** How long a view waits for a renderer to post a fresh picture. */
const VIEW_WAIT_MS = 12_000;
const POLL_MS = 300;
/** Base64 of a PNG around 1600 px wide stays well below this. */
const MAX_PNG_BASE64 = 16 * 1024 * 1024;

const canvasPath = nonRootSpacePath.refine(
  (value) => fileKind(value) === "tldraw",
  { message: "Canvas paths end in .tldr" },
);

export const canvasImageContract = defineRpcContract({
  /**
   * A renderer's picture of a canvas as of file `sha256`. An empty
   * `pngBase64` means the canvas has no shapes.
   */
  space_canvas_image_put: {
    input: z.object({
      projectId,
      path: canvasPath,
      sha256: z.string().min(1).max(128),
      pngBase64: z.string().max(MAX_PNG_BASE64),
    }),
    output: z.object({ ok: z.literal(true) }),
  },
});

interface CanvasImage {
  sha256: string;
  /** Empty when the canvas has no shapes. */
  pngBase64: string;
}

/** Stored pictures and render-only requests, one per plugin database. */
function createImageStore(bb: BbPluginApi) {
  const db = bb.storage.database();
  const getRow = db.prepare(
    `SELECT sha256, png AS pngBase64 FROM canvas_images WHERE project_id = ? AND path = ?`,
  );
  const upsert = db.prepare(
    `INSERT INTO canvas_images (project_id, path, sha256, png, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (project_id, path) DO UPDATE SET
         sha256 = excluded.sha256, png = excluded.png, updated_at = excluded.updated_at`,
  );
  const findRender = db.prepare(
    `SELECT id FROM pending_draws WHERE project_id = ? AND path = ? AND spec = ? LIMIT 1`,
  );
  const insertRender = db.prepare(
    `INSERT INTO pending_draws (project_id, path, spec, created_at) VALUES (?, ?, ?, ?)`,
  );
  const removeRender = db.prepare(`DELETE FROM pending_draws WHERE id = ? AND spec = ?`);

  return {
    get(project: string, path: string): CanvasImage | null {
      return (getRow.get(project, path) as CanvasImage | undefined) ?? null;
    },
    put(project: string, path: string, sha256: string, pngBase64: string): void {
      upsert.run(project, path, sha256, pngBase64, Date.now());
    },
    /** Queues a render-only batch unless one is waiting; its id, and whether it is new. */
    requestRender(project: string, path: string): { id: number; queued: boolean } {
      const existing = findRender.get(project, path, RENDER_ONLY_SPEC) as { id: number } | undefined;
      if (existing !== undefined) return { id: existing.id, queued: false };
      const id = Number(
        insertRender.run(project, path, RENDER_ONLY_SPEC, Date.now()).lastInsertRowid,
      );
      return { id, queued: true };
    },
    /** Drops a render-only batch nobody picked up. */
    cancelRender(id: number): void {
      removeRender.run(id, RENDER_ONLY_SPEC);
    },
  };
}

type ImageStore = ReturnType<typeof createImageStore>;

const stores = new WeakMap<BbPluginApi, ImageStore>();

function imageStore(bb: BbPluginApi): ImageStore {
  let store = stores.get(bb);
  if (store === undefined) {
    store = createImageStore(bb);
    stores.set(bb, store);
  }
  return store;
}

type CanvasView =
  | { kind: "image"; sha256: string; pngBase64: string }
  | { kind: "empty" }
  | { kind: "missing" }
  | { kind: "timeout" };

type ViewDeps = Pick<ServerContext, "bb" | "resolveSpace">;

async function readCanvasFile(
  bb: BbPluginApi,
  space: ProjectSpace,
  path: string,
): Promise<{ sha256: string; blank: boolean } | null> {
  try {
    const file = await bb.sdk.files.read({
      hostId: space.hostId,
      path: absolute(space, path),
      rootPath: space.rootPath,
    });
    const text =
      file.contentEncoding === "utf8"
        ? file.content
        : Buffer.from(file.content, "base64").toString("utf8");
    return { sha256: file.sha256, blank: text.trim() === "" };
  } catch {
    return null;
  }
}

/**
 * The canvas's picture as it stands on disk: the stored one if it was drawn
 * from the current file, else a fresh one from a renderer, waiting up to 12 s.
 */
async function viewCanvas(
  { bb, resolveSpace }: ViewDeps,
  id: string,
  path: string,
  signal?: AbortSignal,
): Promise<CanvasView> {
  const store = imageStore(bb);
  const space = await resolveSpace(id);
  const deadline = Date.now() + VIEW_WAIT_MS;
  let request: { id: number; queued: boolean } | null = null;
  try {
    while (!signal?.aborted) {
      const file = await readCanvasFile(bb, space, path);
      if (file === null) return { kind: "missing" };
      if (file.blank) return { kind: "empty" };
      const image = store.get(space.projectId, path);
      if (image !== null && image.sha256 === file.sha256) {
        return image.pngBase64 === ""
          ? { kind: "empty" }
          : { kind: "image", sha256: image.sha256, pngBase64: image.pngBase64 };
      }
      if (Date.now() >= deadline) break;
      if (request === null) {
        request = store.requestRender(space.projectId, path);
        bb.realtime.publish("space-draw", { projectId: space.projectId, path });
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    return { kind: "timeout" };
  } finally {
    // A request this call queued and nobody answered would linger in the
    // queue; the next view asks again.
    if (request?.queued) store.cancelRender(request.id);
  }
}

function viewMessage(view: Exclude<CanvasView, { kind: "image" }>, path: string): string {
  switch (view.kind) {
    case "missing":
      return `${path} does not exist in the space.`;
    case "empty":
      return `${path} is an empty canvas: there is nothing to picture.`;
    case "timeout":
      return [
        `No bb window rendered ${path} within ${VIEW_WAIT_MS / 1000} s, so there is no current picture of it.`,
        "Pictures come from a bb window that is open and visible (any page, on a local address or with a tldraw license key).",
        "Use space_canvas_read for a text description instead.",
      ].join("\n");
  }
}

/** `bb space canvas <path> --png <out>`: writes the picture, returns what to print. */
export async function canvasPngCommand(
  deps: ViewDeps,
  id: string,
  path: string,
  out: string,
  ctx: { cwd?: string; threadId?: string; signal?: AbortSignal },
): Promise<string> {
  // A path-segment check, so `my.bb-space-notes/` is fine.
  if (out.split(/[\\/]/).includes(".bb-space")) {
    throw new PluginCliError("canvas pictures are not written into the space", {
      code: "invalid_path",
      hint: "Write the PNG outside .bb-space/, e.g. /tmp/canvas.png.",
    });
  }
  const view = await viewCanvas(deps, id, path, ctx.signal);
  if (view.kind !== "image") {
    throw new PluginCliError(viewMessage(view, path), {
      code: view.kind === "timeout" ? "render_timeout" : `canvas_${view.kind}`,
    });
  }
  const written = await writeInvokerFile(deps.bb, out, view.pngBase64, ctx, "--png");
  return `Wrote a picture of ${path} to ${written}`;
}

export const canvasImageModule = defineModule({
  contract: canvasImageContract,
  register(ctx) {
    const store = imageStore(ctx.bb);

    ctx.bb.agents.registerTool({
      name: "space_canvas_view",
      description:
        "Look at a tldraw canvas (.tldr) in the project space as a PNG picture, the way the " +
        "user sees it in bb's Space page. Use it after space_draw to check a diagram's layout. " +
        "Needs a bb window open to render; otherwise it says so within about 12 seconds. " +
        "space_canvas_read gives the same canvas as text.",
      presentation: {
        label: { pending: "Looking at a canvas", completed: "Looked at a canvas" },
      },
      parameters: z.object({ path: canvasPath }),
      async execute({ path }, toolCtx) {
        try {
          const view = await viewCanvas(ctx, toolCtx.projectId, path, toolCtx.signal);
          if (view.kind !== "image") {
            return {
              content: [{ type: "text", text: viewMessage(view, path) }],
              isError: view.kind !== "empty",
            };
          }
          return {
            content: [
              { type: "text", text: `${path} as rendered from the file on disk.` },
              { type: "image", data: view.pngBase64, mimeType: "image/png" },
            ],
          };
        } catch (cause) {
          return { content: [{ type: "text", text: String(cause instanceof Error ? cause.message : cause) }], isError: true };
        }
      },
    });

    const rpc: PluginRpcHandlers<typeof canvasImageContract> = {
      space_canvas_image_put: ({ projectId: id, path, sha256, pngBase64 }) => {
        store.put(id, path, sha256, pngBase64);
        return { ok: true as const };
      },
    };
    return { rpc };
  },
});
