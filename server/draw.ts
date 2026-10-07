// Agent drawing: the draw queue, the `space_draw` / `space_canvas_read` agent
// tools, the `space_draw_*` RPC renderers poll, and `bb space draw|canvas`.
//
// Agents describe diagrams as a DrawSpec; tldraw turns specs into shapes,
// and tldraw runs in the browser. So a batch is queued here and applied by
// whichever renderer gets it first: the open canvas, or the off-screen
// editor every bb window keeps (ui/headless.tsx). The renderer saves the
// .tldr file and acks the batch.
import {
  PluginCliError,
  cliCommand,
  defineRpcContract,
  type PluginRpcHandlers,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { LINT_HINT, lintTldr } from "../lib/canvas/lint";
import { describeTldr, drawnNodeIds } from "../lib/canvas/read";
import { RENDER_ONLY_SPEC, drawSpecSchema, type DrawSpec } from "../lib/canvas/spec";
import { fileKind } from "../lib/space";
import { canvasPngCommand } from "./canvas-image";
import { projectOption, readInvokerFile, requireProject } from "./cli";
import { defineModule } from "./context";
import { absolute, checkoutOf, nonRootSpacePath, projectId } from "./space";

/** Realtime channel: payload `{ projectId, path }` — a drawing batch is queued. */
export const SPACE_DRAW = "space-draw";

const drawBatchSchema = z.object({
  id: z.number().int(),
  projectId: z.string(),
  path: z.string(),
  /** A JSON-encoded DrawSpec, validated when it was queued. */
  spec: z.string(),
});
export type DrawBatch = z.infer<typeof drawBatchSchema>;

const canvasPath = nonRootSpacePath.refine(
  (value) => fileKind(value) === "tldraw",
  { message: "Canvas paths end in .tldr" },
);

export const drawContract = defineRpcContract({
  /** Queued drawing batches; filter by project and path, or list them all. */
  space_draw_pending: {
    input: z.object({
      projectId: projectId.optional(),
      path: nonRootSpacePath.optional(),
    }),
    output: z.object({ batches: z.array(drawBatchSchema) }),
  },
  /** What the off-screen renderer needs before it mounts tldraw. */
  space_canvas_config: {
    input: z.null(),
    output: z.object({ licenseKey: z.string() }),
  },
  /** A renderer applied these batches and saved the file. */
  space_draw_ack: {
    input: z.object({ ids: z.array(z.number().int()).max(500) }),
    output: z.object({ ok: z.literal(true) }),
  },
});

// Recorded by the host: never edit a statement (whitespace included), only
// append new ones.
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS pending_draws (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       project_id TEXT NOT NULL,
       path TEXT NOT NULL,
       spec TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
  // Canvas pictures (server/canvas-image.ts).
  `CREATE TABLE IF NOT EXISTS canvas_images (
       project_id TEXT NOT NULL,
       path TEXT NOT NULL,
       sha256 TEXT NOT NULL,
       png TEXT NOT NULL,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (project_id, path)
     )`,
  // Why a canvas could not be pictured (a file tldraw cannot load).
  `ALTER TABLE canvas_images ADD COLUMN error TEXT`,
];

/** How long a draw call waits for a renderer to land its batch. */
const DRAW_WAIT_MS = 12_000;

function parseCanvasPath(value: string): string {
  const path = canvasPath.safeParse(value);
  if (!path.success) {
    throw new PluginCliError(`invalid canvas path: ${value}`, {
      code: "invalid_path",
      hint: "Use a space-relative path ending in .tldr, without `..`.",
    });
  }
  return path.data;
}

export const drawModule = defineModule({
  contract: drawContract,
  register({ bb, settings, resolveSpace, readText, notifyChanged }) {
    const db = bb.storage.database();
    bb.storage.migrate(db, MIGRATIONS);
    const insertDraw = db.prepare(
      `INSERT INTO pending_draws (project_id, path, spec, created_at) VALUES (?, ?, ?, ?)`,
    );
    const pendingCount = db.prepare(
      `SELECT COUNT(*) AS n FROM pending_draws WHERE id <= ? AND project_id = ? AND path = ?`,
    );

    function listPending(filter: { projectId?: string; path?: string }): DrawBatch[] {
      const rows = db
        .prepare(
          `SELECT id, project_id AS projectId, path, spec FROM pending_draws
            WHERE (? IS NULL OR project_id = ?) AND (? IS NULL OR path = ?)
            ORDER BY id ASC LIMIT 200`,
        )
        .all(
          filter.projectId ?? null,
          filter.projectId ?? null,
          filter.path ?? null,
          filter.path ?? null,
        ) as DrawBatch[];
      return rows;
    }

    /**
     * Queues a batch and waits for a renderer to apply it. Returns the text an
     * agent gets back: where it landed, and the canvas as it now stands.
     */
    async function draw(
      id: string,
      path: string,
      spec: DrawSpec,
      signal?: AbortSignal,
    ): Promise<string> {
      const space = await resolveSpace(id);
      const before = await readText(space, path);
      if (before === null) {
        // A new canvas: an empty file is a blank board.
        await bb.sdk.files.write({
          hostId: space.hostId,
          path: absolute(space, path),
          rootPath: checkoutOf(space),
          content: "",
          createParents: true,
          expectedSha256: null,
        });
        notifyChanged(space.projectId);
      }
      const drawn = drawnNodeIds(before ?? "");
      const resent = (spec.nodes ?? []).filter((node) => drawn.has(node.id)).length;
      const batchId = Number(
        insertDraw.run(space.projectId, path, JSON.stringify(spec), Date.now())
          .lastInsertRowid,
      );
      bb.realtime.publish(SPACE_DRAW, { projectId: space.projectId, path });

      const deadline = Date.now() + DRAW_WAIT_MS;
      let applied = false;
      while (Date.now() < deadline && !signal?.aborted) {
        const { n } = pendingCount.get(batchId, space.projectId, path) as { n: number };
        if (n === 0) {
          applied = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      const placement = spec.clear
        ? "The canvas was cleared first."
        : drawn.size > 0 && resent === 0 && (spec.nodes?.length ?? 0) > 0
          ? "All node ids were new, so this is a separate diagram placed below what was already there. Use clear: true to replace a drawing instead."
          : resent > 0
            ? `${resent} node(s) already on the canvas were updated in place.`
            : "";
      if (!applied) {
        return [
          `Queued for ${path}, but no bb window has rendered it yet (no window open, or tldraw cannot run on this address).`,
          "It is applied the next time the canvas is opened in the Space page.",
          placement,
        ]
          .filter(Boolean)
          .join("\n");
      }
      const after = (await readText(space, path)) ?? "";
      return [
        `Drew on ${path}. ${placement}`.trim(),
        "",
        describeTldr(after, path),
        ...(lintTldr(after).length > 0 ? [LINT_HINT] : []),
        "",
        "To see it as the user does, call space_canvas_view.",
      ].join("\n");
    }

    async function readCanvas(id: string, path: string): Promise<string> {
      const space = await resolveSpace(id);
      const content = await readText(space, path);
      if (content === null) return `${path} does not exist in the space.`;
      const queued = listPending({ projectId: space.projectId, path }).filter(
        (batch) => batch.spec !== RENDER_ONLY_SPEC,
      ).length;
      return (
        describeTldr(content, path) +
        (queued > 0 ? `\n\n${queued} drawing batch(es) are queued and not rendered yet.` : "")
      );
    }

    bb.agents.registerTool({
      name: "space_draw",
      description:
        "Draw or update a boxes-and-arrows diagram in a tldraw canvas file (.tldr) in the " +
        "project space (.bb-space/), which the user reads in bb's Space page. `path` is " +
        "space-relative, e.g. architecture/overview.tldr; a missing file is created. Nodes are " +
        "labelled shapes; edges connect node ids with bound arrows that follow moved shapes. " +
        "Omit x/y and nodes are auto-laid-out in layers along the edges (layout 'lr' or 'tb'). " +
        "Send a whole diagram in one call. Re-sending a node id updates it in place. A batch " +
        "whose node ids are all new is drawn below the existing drawing, so pass clear: true " +
        "to replace it. Returns the canvas as it stands afterwards.",
      presentation: {
        label: { pending: "Drawing in the project space", completed: "Drew in the project space" },
      },
      parameters: drawSpecSchema.extend({ path: canvasPath }),
      async execute({ path, ...spec }, ctx) {
        try {
          return await draw(ctx.projectId, path, spec, ctx.signal);
        } catch (cause) {
          return { content: [{ type: "text", text: String(cause instanceof Error ? cause.message : cause) }], isError: true };
        }
      },
    });

    bb.agents.registerTool({
      name: "space_canvas_read",
      description:
        "Read a tldraw canvas (.tldr) in the project space as text: nodes with ids, labels, " +
        "colors and positions, arrows between them, text, and shapes the user drew by hand. " +
        "Use it before updating a diagram the user may have edited.",
      presentation: {
        label: { pending: "Reading a canvas", completed: "Read a canvas" },
      },
      parameters: z.object({ path: canvasPath }),
      async execute({ path }, ctx) {
        try {
          return await readCanvas(ctx.projectId, path);
        } catch (cause) {
          return { content: [{ type: "text", text: String(cause instanceof Error ? cause.message : cause) }], isError: true };
        }
      },
    });

    const rpc: PluginRpcHandlers<typeof drawContract> = {
      space_canvas_config: async () => {
        const { tldrawLicenseKey } = await settings.get();
        return { licenseKey: tldrawLicenseKey.trim() };
      },
      space_draw_pending: ({ projectId: id, path }) => ({
        batches: listPending({
          ...(id === undefined ? {} : { projectId: id }),
          ...(path === undefined ? {} : { path }),
        }),
      }),
      space_draw_ack: ({ ids }) => {
        const remove = db.prepare(`DELETE FROM pending_draws WHERE id = ?`);
        db.transaction(() => {
          for (const id of ids) remove.run(id);
        })();
        return { ok: true as const };
      },
    };

    const cli = {
      draw: cliCommand({
        summary:
          "Draw a diagram spec (JSON file) into a .tldr canvas in the space; prefer the space_draw tool when available",
        positionals: [
          { name: "path", description: "Space-relative canvas path ending in .tldr, e.g. architecture/overview.tldr", required: true },
        ],
        options: {
          project: projectOption,
          "spec-file": {
            type: "string",
            description:
              "JSON file with { clear?, layout?, nodes?, edges?, texts? } — the space_draw tool's arguments without path. Relative to the current directory.",
            aliases: ["spec", "file"],
          },
        },
        async run(input, ctx) {
          const id = requireProject(input.options.project, ctx);
          const path = parseCanvasPath(input.positionals.path);
          const specFile = input.options["spec-file"];
          if (specFile === undefined) {
            throw new PluginCliError("missing --spec-file", {
              code: "spec_required",
              hint: "Write the spec to a JSON file and pass --spec-file <file>.",
            });
          }
          const raw = await readInvokerFile(bb, specFile, ctx);
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch (cause) {
            throw new PluginCliError(`spec file is not JSON: ${String(cause)}`, { code: "invalid_spec" });
          }
          const spec = drawSpecSchema.safeParse(parsed);
          if (!spec.success) {
            throw new PluginCliError(`invalid spec: ${spec.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`, {
              code: "invalid_spec",
            });
          }
          return { exitCode: 0, stdout: await draw(id, path, spec.data, ctx.signal) };
        },
      }),
      canvas: cliCommand({
        summary: "Describe a .tldr canvas in the space as text (nodes, arrows, text), or save a PNG of it with --png",
        positionals: [
          { name: "path", description: "Space-relative canvas path ending in .tldr", required: true },
        ],
        options: {
          project: projectOption,
          png: {
            type: "string",
            description: "Write a PNG picture of the canvas to this file (outside .bb-space/) instead. Needs a bb window open.",
          },
        },
        async run(input, ctx) {
          const id = requireProject(input.options.project, ctx);
          const path = parseCanvasPath(input.positionals.path);
          if (input.options.png !== undefined) {
            return {
              exitCode: 0,
              stdout: await canvasPngCommand({ bb, resolveSpace }, id, path, input.options.png, ctx),
            };
          }
          return { exitCode: 0, stdout: await readCanvas(id, path) };
        },
      }),
    };

    return { rpc, cli };
  },
});
