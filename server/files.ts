// The `space_*` file RPC the app reads and edits the space through, and the
// `bb space root|init|tree` commands built on the same operations.
import {
  cliCommand,
  defineRpcContract,
  type PluginRpcHandlers,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { normalizeSpacePath } from "../lib/space";
import { followFileChange } from "./annotations";
import { projectOption, requireProject } from "./cli";
import { defineModule } from "./context";
import { absolute, checkoutOf, nonRootSpacePath, projectId } from "./space";

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

export const filesContract = defineRpcContract({
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
});

const INDEX_TEMPLATE = (projectName: string) => `# ${projectName}

This is the project space: living documentation for humans and agents.

- Start here, then follow links to the other pages.
- Agents keep it current; you can edit any page with **Edit**.
`;

const TREE_LIMIT = 5000;
const PREVIEW_TTL_MS = 60 * 60 * 1000;
const PREVIEW_REFRESH_MARGIN_MS = 10 * 60 * 1000;

export const filesModule = defineModule({
  contract: filesContract,
  register({ bb, resolveSpace, spaceExists, ensureWatcher, notifyChanged }) {
    // ── Operations shared by RPC and CLI ──────────────────────────────────
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

    const rpc: PluginRpcHandlers<typeof filesContract> = {
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
        await followFileChange(bb, space, { kind: "move", from, to });
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
        await followFileChange(bb, space, { kind: "remove", path });
        notifyChanged(space.projectId);
        return { ok: true as const };
      },
      space_preview: ({ projectId: id }) => preview(id),
    };

    const cli = {
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
    };

    return { rpc, cli };
  },
});
