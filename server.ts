// Project Space — backend.
//
// Every project gets a space: the `.bb-space/` directory in its default
// checkout. Agents write there with ordinary file tools; the app reads and
// edits it through the RPC below. All file I/O goes through `bb.sdk.files`
// with the project source's host, so a project on an enrolled machine works
// the same as a local one. When that host is the server machine, a recursive
// fs.watch publishes `space-changed` so open pages follow agents' writes.
import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { describeTldr, drawnNodeIds } from "./lib/canvas/read";
import { drawSpecSchema, type DrawSpec } from "./lib/canvas/spec";
import {
  SPACE_DIR,
  fileKind,
  joinSpacePath,
  normalizeSpacePath,
} from "./lib/space";

/** Realtime channel: payload `{ projectId }`. */
export const SPACE_CHANGED = "space-changed";
/** Realtime channel: payload `{ projectId, path }` — a drawing batch is queued. */
export const SPACE_DRAW = "space-draw";

const spacePath = z
  .string()
  .max(1024)
  .transform((value, ctx) => {
    const normalized = normalizeSpacePath(value);
    if (normalized === null) {
      ctx.addIssue({ code: "custom", message: `Invalid space path: ${value}` });
      return z.NEVER;
    }
    return normalized;
  });
const nonRootSpacePath = spacePath.refine((value) => value !== "", {
  message: "Path must name a file or folder inside the space",
});
const projectId = z.string().min(1).max(128);

const projectInfoSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  /** Absolute path of `.bb-space` on the project's host. */
  rootPath: z.string(),
  exists: z.boolean(),
  /** True when the server sees file changes live; otherwise the app polls. */
  watching: z.boolean(),
});
export type SpaceInfo = z.infer<typeof projectInfoSchema>;

const treeEntrySchema = z.object({
  path: z.string(),
  kind: z.enum(["file", "directory"]),
});
export type SpaceTreeEntry = z.infer<typeof treeEntrySchema>;

const fileSchema = z.object({
  path: z.string(),
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]),
  sha256: z.string(),
  sizeBytes: z.number(),
  modifiedAtMs: z.number().nullable(),
});
export type SpaceFile = z.infer<typeof fileSchema>;

const writeResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("written"), sha256: z.string() }),
  z.object({
    outcome: z.literal("conflict"),
    currentSha256: z.string().nullable(),
  }),
]);
export type SpaceWriteResult = z.infer<typeof writeResultSchema>;

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

export const rpcContract = defineRpcContract({
  space_projects: {
    input: z.null(),
    output: z.object({
      projects: z.array(
        z.object({ id: z.string(), name: z.string(), hasSpace: z.boolean() }),
      ),
    }),
  },
  space_info: {
    input: z.object({ projectId }),
    output: projectInfoSchema,
  },
  space_init: {
    input: z.object({ projectId }),
    output: z.object({ created: z.boolean(), indexPath: z.string() }),
  },
  space_tree: {
    input: z.object({ projectId }),
    output: z.object({
      entries: z.array(treeEntrySchema),
      truncated: z.boolean(),
    }),
  },
  space_read: {
    input: z.object({ projectId, path: nonRootSpacePath }),
    output: fileSchema,
  },
  space_write: {
    input: z.object({
      projectId,
      path: nonRootSpacePath,
      content: z.string(),
      encoding: z.enum(["utf8", "base64"]).default("utf8"),
      // A sha guards an edit; null creates only when absent; omitted overwrites.
      expectedSha256: z.string().nullable().optional(),
    }),
    output: writeResultSchema,
  },
  space_mkdir: {
    input: z.object({ projectId, path: nonRootSpacePath }),
    output: z.object({ ok: z.literal(true) }),
  },
  space_move: {
    input: z.object({ projectId, from: nonRootSpacePath, to: nonRootSpacePath }),
    output: z.object({ ok: z.literal(true) }),
  },
  space_remove: {
    input: z.object({ projectId, path: nonRootSpacePath }),
    output: z.object({ ok: z.literal(true) }),
  },
  space_preview: {
    input: z.object({ projectId }),
    output: z.object({ baseUrl: z.string(), expiresAtMs: z.number() }),
  },
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

interface ProjectSpace {
  projectId: string;
  projectName: string;
  hostId: string;
  /** Absolute `.bb-space` path on `hostId`. */
  rootPath: string;
  isLocal: boolean;
}

const INDEX_TEMPLATE = (projectName: string) => `# ${projectName}

This is the project space: living documentation for humans and agents.

- Start here, then follow links to the other pages.
- Agents keep it current; you can edit any page with **Edit**.
`;

const TREE_LIMIT = 5000;
const PREVIEW_TTL_MS = 60 * 60 * 1000;
const PREVIEW_REFRESH_MARGIN_MS = 10 * 60 * 1000;
const PROJECT_CACHE_MS = 30_000;
/** How long a draw call waits for a renderer to land its batch. */
const DRAW_WAIT_MS = 12_000;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    treePosition: {
      type: "select",
      label: "File tree position",
      description:
        "Right puts the tree in the page's side panel; left keeps it beside the document.",
      options: ["right", "left"],
      default: "right",
    },
    tldrawLicenseKey: {
      type: "string",
      label: "tldraw license key",
      description:
        "Only needed when bb is opened over a non-local https address (for example bb connect). tldraw runs free on local addresses.",
      default: "",
    },
  });

  const projectCache = new Map<
    string,
    { space: ProjectSpace; loadedAt: number }
  >();
  let primaryHostId: string | null | undefined;

  async function serverHostId(): Promise<string | null> {
    if (primaryHostId === undefined) {
      primaryHostId = (await bb.sdk.system.config()).primaryHostId;
    }
    return primaryHostId;
  }

  async function resolveSpace(id: string): Promise<ProjectSpace> {
    const cached = projectCache.get(id);
    if (cached && Date.now() - cached.loadedAt < PROJECT_CACHE_MS) {
      return cached.space;
    }
    const project = await bb.sdk.projects.get({ projectId: id });
    const source =
      project.sources.find((candidate) => candidate.isDefault) ??
      project.sources[0];
    if (source === undefined || typeof source.path !== "string") {
      throw new Error(
        `Project ${project.name} has no local checkout, so it has no space.`,
      );
    }
    const checkout = source.path.replace(/\/+$/, "");
    const space: ProjectSpace = {
      projectId: project.id,
      projectName: project.name,
      hostId: source.hostId,
      rootPath: `${checkout}/${SPACE_DIR}`,
      isLocal: source.hostId === (await serverHostId()),
    };
    projectCache.set(id, { space, loadedAt: Date.now() });
    return space;
  }

  function absolute(space: ProjectSpace, path: string): string {
    return path === "" ? space.rootPath : `${space.rootPath}/${path}`;
  }

  async function spaceExists(space: ProjectSpace): Promise<boolean> {
    if (space.isLocal) {
      try {
        return (await stat(space.rootPath)).isDirectory();
      } catch {
        return false;
      }
    }
    // listPaths does not fail for a missing directory, so look for the space
    // from the checkout root instead.
    try {
      const result = await bb.sdk.files.listPaths({
        hostId: space.hostId,
        path: checkoutOf(space),
        query: SPACE_DIR,
        includeFiles: false,
        includeDirectories: true,
        includeHidden: true,
        limit: 50,
      });
      return result.paths.some((entry) => entry.path === SPACE_DIR);
    } catch {
      return false;
    }
  }

  function checkoutOf(space: ProjectSpace): string {
    return space.rootPath.slice(0, -SPACE_DIR.length - 1);
  }

  // ── Live change notifications ────────────────────────────────────────────
  // One recursive watcher per local space, started the first time the app
  // touches that project and kept until the plugin unloads.
  const watchers = new Map<string, FSWatcher>();
  const pendingNotify = new Map<string, ReturnType<typeof setTimeout>>();

  function notifyChanged(projectIdToNotify: string): void {
    const existing = pendingNotify.get(projectIdToNotify);
    if (existing !== undefined) clearTimeout(existing);
    pendingNotify.set(
      projectIdToNotify,
      setTimeout(() => {
        pendingNotify.delete(projectIdToNotify);
        bb.realtime.publish(SPACE_CHANGED, { projectId: projectIdToNotify });
      }, 250),
    );
  }

  function ensureWatcher(space: ProjectSpace): boolean {
    if (!space.isLocal) return false;
    if (watchers.has(space.projectId)) return true;
    try {
      const watcher = watch(space.rootPath, { recursive: true }, () =>
        notifyChanged(space.projectId),
      );
      watcher.on("error", (error) => {
        bb.log.warn(`space watcher for ${space.projectId} stopped: ${String(error)}`);
        watcher.close();
        watchers.delete(space.projectId);
      });
      watchers.set(space.projectId, watcher);
      return true;
    } catch {
      // The directory does not exist yet; space_init starts the watcher.
      return false;
    }
  }

  bb.onDispose(() => {
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    for (const timer of pendingNotify.values()) clearTimeout(timer);
    pendingNotify.clear();
  });

  // ── Operations shared by RPC and CLI ────────────────────────────────────
  async function info(id: string): Promise<SpaceInfo> {
    const space = await resolveSpace(id);
    const exists = await spaceExists(space);
    return {
      projectId: space.projectId,
      projectName: space.projectName,
      rootPath: space.rootPath,
      exists,
      // Without a space there is nothing to watch; the app polls until
      // space_init creates it.
      watching: exists ? ensureWatcher(space) : false,
    };
  }

  async function init(id: string) {
    const space = await resolveSpace(id);
    const indexPath = "index.md";
    const result = await bb.sdk.files.write({
      hostId: space.hostId,
      path: absolute(space, indexPath),
      rootPath: checkoutOf(space),
      content: INDEX_TEMPLATE(space.projectName),
      createParents: true,
      expectedSha256: null,
    });
    ensureWatcher(space);
    notifyChanged(space.projectId);
    return { created: result.outcome === "written", indexPath };
  }

  async function tree(id: string) {
    const space = await resolveSpace(id);
    if (space.isLocal && (await spaceExists(space))) ensureWatcher(space);
    const result = await bb.sdk.files.listPaths({
      hostId: space.hostId,
      path: space.rootPath,
      includeFiles: true,
      includeDirectories: true,
      includeHidden: false,
      limit: TREE_LIMIT,
    });
    const entries = result.paths
      .map((entry) => ({
        path: normalizeSpacePath(entry.path),
        kind: entry.kind,
      }))
      .filter(
        (entry): entry is SpaceTreeEntry =>
          entry.path !== null && entry.path !== "",
      )
      .sort((a, b) => a.path.localeCompare(b.path));
    return { entries, truncated: result.truncated };
  }

  const previews = new Map<string, { baseUrl: string; expiresAtMs: number }>();

  async function preview(id: string) {
    const cached = previews.get(id);
    if (
      cached !== undefined &&
      cached.expiresAtMs - Date.now() > PREVIEW_REFRESH_MARGIN_MS
    ) {
      return cached;
    }
    const space = await resolveSpace(id);
    const created = await bb.sdk.files.createPreview({
      hostId: space.hostId,
      rootPath: space.rootPath,
      ttlMs: PREVIEW_TTL_MS,
    });
    const value = {
      baseUrl: created.baseUrl.replace(/\/?$/, "/"),
      expiresAtMs: created.expiresAtMs,
    };
    previews.set(id, value);
    return value;
  }

  // ── Drawing queue ────────────────────────────────────────────────────────
  // Agents describe diagrams as a DrawSpec; tldraw turns specs into shapes,
  // and tldraw runs in the browser. So a batch is queued here and applied by
  // whichever renderer gets it first: the open canvas, or the off-screen
  // editor every bb window keeps (ui/headless.tsx). The renderer saves the
  // .tldr file and acks the batch.
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS pending_draws (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       project_id TEXT NOT NULL,
       path TEXT NOT NULL,
       spec TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
  ]);
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

  async function readText(space: ProjectSpace, path: string): Promise<string | null> {
    try {
      const file = await bb.sdk.files.read({
        hostId: space.hostId,
        path: absolute(space, path),
        rootPath: space.rootPath,
      });
      return file.contentEncoding === "utf8"
        ? file.content
        : Buffer.from(file.content, "base64").toString("utf8");
    } catch {
      return null;
    }
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
    ].join("\n");
  }

  async function readCanvas(id: string, path: string): Promise<string> {
    const space = await resolveSpace(id);
    const content = await readText(space, path);
    if (content === null) return `${path} does not exist in the space.`;
    const queued = listPending({ projectId: space.projectId, path }).length;
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

  bb.rpc.register(rpcContract, {
    space_projects: async () => {
      const projects = await bb.sdk.projects.list();
      const rows = await Promise.all(
        projects.map(async (project) => {
          let hasSpace = false;
          try {
            hasSpace = await spaceExists(await resolveSpace(project.id));
          } catch {
            hasSpace = false;
          }
          return { id: project.id, name: project.name, hasSpace };
        }),
      );
      return { projects: rows };
    },
    space_info: ({ projectId: id }) => info(id),
    space_init: ({ projectId: id }) => init(id),
    space_tree: ({ projectId: id }) => tree(id),
    space_read: async ({ projectId: id, path }) => {
      const space = await resolveSpace(id);
      const file = await bb.sdk.files.read({
        hostId: space.hostId,
        path: absolute(space, path),
        rootPath: space.rootPath,
      });
      return {
        path,
        content: file.content,
        encoding: file.contentEncoding,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        modifiedAtMs: file.modifiedAtMs ?? null,
      };
    },
    space_write: async ({
      projectId: id,
      path,
      content,
      encoding,
      expectedSha256,
    }) => {
      const space = await resolveSpace(id);
      const result = await bb.sdk.files.write({
        hostId: space.hostId,
        path: absolute(space, path),
        rootPath: space.rootPath,
        content,
        contentEncoding: encoding,
        createParents: true,
        ...(expectedSha256 === undefined ? {} : { expectedSha256 }),
      });
      if (result.outcome === "written") notifyChanged(space.projectId);
      return result.outcome === "written"
        ? { outcome: "written" as const, sha256: result.sha256 }
        : { outcome: "conflict" as const, currentSha256: result.currentSha256 };
    },
    space_mkdir: async ({ projectId: id, path }) => {
      const space = await resolveSpace(id);
      await bb.sdk.files.mkdir({
        hostId: space.hostId,
        path: absolute(space, path),
        rootPath: space.rootPath,
        recursive: true,
      });
      notifyChanged(space.projectId);
      return { ok: true as const };
    },
    space_move: async ({ projectId: id, from, to }) => {
      const space = await resolveSpace(id);
      await bb.sdk.files.move({
        hostId: space.hostId,
        sourcePath: absolute(space, from),
        destinationPath: absolute(space, to),
        rootPath: space.rootPath,
      });
      notifyChanged(space.projectId);
      return { ok: true as const };
    },
    space_remove: async ({ projectId: id, path }) => {
      const space = await resolveSpace(id);
      await bb.sdk.files.remove({
        hostId: space.hostId,
        path: absolute(space, path),
        rootPath: space.rootPath,
        recursive: true,
      });
      notifyChanged(space.projectId);
      return { ok: true as const };
    },
    space_preview: ({ projectId: id }) => preview(id),
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
  });

  // ── CLI: `bb space …` ─────────────────────────────────────────────────────
  const projectOption = {
    type: "string",
    description:
      "Project id (proj_…). Defaults to the project of the calling thread.",
    aliases: ["project-id"],
  } as const;

  function requireProject(
    explicit: string | undefined,
    ctx: { projectId?: string },
  ): string {
    const id = explicit ?? ctx.projectId;
    if (id === undefined || id === "") {
      throw new PluginCliError("no project in context", {
        code: "project_required",
        hint: "Pass --project <proj_id>; `bb project list` shows ids.",
      });
    }
    return id;
  }

  /** Reads a file named on the command line from the machine that ran `bb`. */
  async function readInvokerFile(
    file: string,
    ctx: { cwd?: string; threadId?: string },
  ): Promise<string> {
    const path = file.startsWith("/")
      ? file
      : ctx.cwd
        ? `${ctx.cwd.replace(/\/+$/, "")}/${file}`
        : null;
    if (path === null) {
      throw new PluginCliError("relative --spec-file without a working directory", {
        code: "invalid_path",
        hint: "Pass an absolute path.",
      });
    }
    let hostId: string | undefined;
    if (ctx.threadId) {
      try {
        const thread = await bb.sdk.threads.get({ threadId: ctx.threadId });
        hostId = (thread as { environment?: { hostId?: string } | null }).environment?.hostId;
      } catch {
        hostId = undefined;
      }
    }
    try {
      const result = await bb.sdk.files.read({ ...(hostId ? { hostId } : {}), path });
      return result.contentEncoding === "utf8"
        ? result.content
        : Buffer.from(result.content, "base64").toString("utf8");
    } catch (cause) {
      throw new PluginCliError(`cannot read ${path}: ${String(cause)}`, { code: "file_unreadable" });
    }
  }

  bb.cli.register(
    defineCli({
      name: "space",
      summary: "Find and set up the project space (.bb-space) agents document a project in",
      commands: {
        root: cliCommand({
          summary:
            "Print the absolute path of the project's live space directory",
          options: { project: projectOption, json: { type: "boolean", description: "Emit JSON" } },
          async run(input, ctx) {
            const result = await info(requireProject(input.options.project, ctx));
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(result)
                : `${result.rootPath}${result.exists ? "" : "\n(not created yet: run `bb space init`)"}`,
            };
          },
        }),
        init: cliCommand({
          summary: "Create the space with a starter index.md if it does not exist",
          options: { project: projectOption },
          async run(input, ctx) {
            const id = requireProject(input.options.project, ctx);
            const result = await init(id);
            const space = await resolveSpace(id);
            return {
              exitCode: 0,
              stdout: result.created
                ? `Created ${space.rootPath}/${result.indexPath}`
                : `Space already exists at ${space.rootPath}`,
            };
          },
        }),
        tree: cliCommand({
          summary: "List the space's files and folders (up to 5000 entries)",
          options: { project: projectOption, json: { type: "boolean", description: "Emit JSON" } },
          async run(input, ctx) {
            const result = await tree(requireProject(input.options.project, ctx));
            if (input.options.json) {
              return { exitCode: 0, stdout: JSON.stringify(result) };
            }
            const lines = result.entries.map((entry) =>
              entry.kind === "directory" ? `${entry.path}/` : entry.path,
            );
            if (result.truncated) lines.push("… (truncated)");
            return {
              exitCode: 0,
              stdout: lines.length === 0 ? "(empty space)" : lines.join("\n"),
            };
          },
        }),
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
            const path = canvasPath.safeParse(input.positionals.path);
            if (!path.success) {
              throw new PluginCliError(`invalid canvas path: ${input.positionals.path}`, {
                code: "invalid_path",
                hint: "Use a space-relative path ending in .tldr, without `..`.",
              });
            }
            const specFile = input.options["spec-file"];
            if (specFile === undefined) {
              throw new PluginCliError("missing --spec-file", {
                code: "spec_required",
                hint: "Write the spec to a JSON file and pass --spec-file <file>.",
              });
            }
            const raw = await readInvokerFile(specFile, ctx);
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
            return { exitCode: 0, stdout: await draw(id, path.data, spec.data, ctx.signal) };
          },
        }),
        canvas: cliCommand({
          summary: "Describe a .tldr canvas in the space as text (nodes, arrows, text)",
          positionals: [
            { name: "path", description: "Space-relative canvas path ending in .tldr", required: true },
          ],
          options: { project: projectOption },
          async run(input, ctx) {
            const id = requireProject(input.options.project, ctx);
            const path = canvasPath.safeParse(input.positionals.path);
            if (!path.success) {
              throw new PluginCliError(`invalid canvas path: ${input.positionals.path}`, {
                code: "invalid_path",
                hint: "Use a space-relative path ending in .tldr, without `..`.",
              });
            }
            return { exitCode: 0, stdout: await readCanvas(id, path.data) };
          },
        }),
        link: cliCommand({
          summary:
            "Print the ::space directive that shows a space file as a card in chat",
          positionals: [
            { name: "path", description: "Space-relative file path, e.g. architecture/overview.md", required: true },
          ],
          options: {
            project: projectOption,
            title: { type: "string", description: "Card title" },
          },
          async run(input, ctx) {
            const id = requireProject(input.options.project, ctx);
            const path = normalizeSpacePath(input.positionals.path);
            if (path === null || path === "") {
              throw new PluginCliError(`invalid space path: ${input.positionals.path}`, {
                code: "invalid_path",
                hint: "Use a path relative to the space root without `..`.",
              });
            }
            const title = input.options.title?.replace(/"/g, "'");
            return {
              exitCode: 0,
              stdout: `::space{project="${id}" path="${joinSpacePath(path)}"${title ? ` title="${title}"` : ""}}`,
            };
          },
        }),
      },
    }),
  );
}
