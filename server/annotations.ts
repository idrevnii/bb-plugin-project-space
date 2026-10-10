// Annotation storage and the `annotations_*` RPC. The model and anchoring
// helpers are in lib/annotations.ts; architecture/annotations.md in the
// space describes the contract.
//
// One JSON file per annotated file, `.space/annotations/<path>.json` inside
// the space, written with compare-and-swap through `bb.sdk.files`. The file's
// location is authoritative for `path`: reads overwrite the stored value, so
// moving an annotation file moves its annotations.
import {
  defineRpcContract,
  type BbPluginApi,
  type PluginRpcHandlers,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  ANNOTATIONS_DIR,
  MAX_COMMENT_LENGTH,
  SPACE_ANNOTATIONS_CHANGED,
  annotationFilePath,
  isMetaPath,
  newAnnotationId,
  type Annotation,
  type AnnotationFile,
} from "../lib/annotations";
import { normalizeSpacePath } from "../lib/space";
import { defineModule } from "./context";
import { absolute, isMissing, nonRootSpacePath, projectId, type ProjectSpace } from "./space";

const anchorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text-quote"),
    exact: z.string().min(1).max(MAX_COMMENT_LENGTH),
    prefix: z.string().max(256),
    suffix: z.string().max(256),
  }),
  z.object({
    kind: z.literal("shapes"),
    shapeIds: z.array(z.string().min(1).max(256)).min(1).max(500),
  }),
  z.object({ kind: z.literal("file") }),
]);

const statusSchema = z.enum(["open", "sent", "resolved"]);
const commentSchema = z.string().trim().min(1).max(MAX_COMMENT_LENGTH);
const sentToSchema = z.object({ threadId: z.string().min(1), at: z.number() });

const annotationSchema = z.object({
  id: z.string(),
  path: z.string(),
  anchor: anchorSchema,
  comment: z.string(),
  status: statusSchema,
  author: z.enum(["user", "agent"]),
  createdAt: z.number(),
  updatedAt: z.number(),
  sentTo: sentToSchema.optional(),
  resolution: z.string().optional(),
});

const annotationFileSchema = z.object({
  version: z.literal(1),
  annotations: z.array(annotationSchema),
});

/** A space file that may carry annotations (not the plugin's own folder). */
const annotatedPath = nonRootSpacePath.refine((value) => !isMetaPath(value), {
  message: "Annotations cannot point into .space/",
});

export const annotationsContract = defineRpcContract({
  annotations_list: {
    input: z.object({ projectId, path: annotatedPath.optional() }),
    output: z.object({ annotations: z.array(annotationSchema) }),
  },
  annotations_create: {
    input: z.object({
      projectId,
      path: annotatedPath,
      anchor: anchorSchema,
      comment: commentSchema,
      author: z.enum(["user", "agent"]).default("user"),
    }),
    output: z.object({ annotation: annotationSchema }),
  },
  annotations_update: {
    input: z.object({
      projectId,
      id: z.string().min(1),
      comment: commentSchema.optional(),
      status: statusSchema.optional(),
      resolution: z.string().max(MAX_COMMENT_LENGTH).optional(),
      sentTo: sentToSchema.optional(),
    }),
    output: z.object({ annotation: annotationSchema }),
  },
  annotations_delete: {
    input: z.object({ projectId, id: z.string().min(1) }),
    output: z.object({ ok: z.literal(true) }),
  },
});

// ── Storage ──────────────────────────────────────────────────────────────────

type Files = Pick<BbPluginApi["sdk"]["files"], "read" | "write" | "listPaths" | "remove">;

const CAS_ATTEMPTS = 5;
const LIST_LIMIT = 5000;

/** Annotation storage for one space; every function goes through `files`. */
export function annotationStore(files: Files, space: ProjectSpace) {
  const at = (path: string) => absolute(space, path);

  async function load(
    path: string,
  ): Promise<{ annotations: Annotation[]; sha256: string | null }> {
    let file;
    try {
      file = await files.read({
        hostId: space.hostId,
        path: at(annotationFilePath(path)),
        rootPath: space.rootPath,
      });
    } catch (error) {
      if (isMissing(error)) return { annotations: [], sha256: null };
      throw new Error(`Annotation file for ${path} could not be read: ${String(error)}`);
    }
    const text =
      file.contentEncoding === "utf8"
        ? file.content
        : Buffer.from(file.content, "base64").toString("utf8");
    let parsed: AnnotationFile;
    try {
      parsed = annotationFileSchema.parse(JSON.parse(text)) as AnnotationFile;
    } catch (error) {
      throw new Error(
        `Annotation file for ${path} is unreadable; fix or delete ${annotationFilePath(path)}: ${String(error)}`,
      );
    }
    return {
      annotations: parsed.annotations.map((annotation) => ({ ...annotation, path })),
      sha256: file.sha256,
    };
  }

  /** Read-modify-write with compare-and-swap, retried on conflict. */
  async function mutate<T>(
    path: string,
    change: (annotations: Annotation[]) => { annotations: Annotation[]; result: T },
  ): Promise<T> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const current = await load(path);
      const { annotations, result } = change(current.annotations);
      const content: AnnotationFile = { version: 1, annotations };
      const written = await files.write({
        hostId: space.hostId,
        path: at(annotationFilePath(path)),
        rootPath: space.rootPath,
        content: `${JSON.stringify(content, null, 2)}\n`,
        createParents: true,
        expectedSha256: current.sha256,
      });
      if (written.outcome === "written") return result;
    }
    throw new Error(`Annotations for ${path} keep changing; try again.`);
  }

  /** Space paths that have an annotation file. */
  async function annotatedPaths(): Promise<string[]> {
    const result = await files.listPaths({
      hostId: space.hostId,
      path: at(ANNOTATIONS_DIR),
      includeFiles: true,
      includeDirectories: false,
      includeHidden: true,
      limit: LIST_LIMIT,
    });
    return result.paths.flatMap((entry) => {
      const relative = normalizeSpacePath(entry.path);
      if (relative === null || !relative.endsWith(".json")) return [];
      return [relative.slice(0, -".json".length)];
    });
  }

  async function list(path?: string): Promise<Annotation[]> {
    const paths = path === undefined ? await annotatedPaths() : [path];
    const loaded = await Promise.all(paths.map((each) => load(each)));
    return loaded
      .flatMap((each) => each.annotations)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async function find(id: string): Promise<Annotation> {
    const annotation = (await list()).find((each) => each.id === id);
    if (annotation === undefined) throw new Error(`No annotation ${id}`);
    return annotation;
  }

  async function removeFile(path: string): Promise<void> {
    try {
      await files.remove({
        hostId: space.hostId,
        path: at(path),
        rootPath: space.rootPath,
        recursive: true,
      });
    } catch {
      // Already gone.
    }
  }

  /** `path` and everything under it, when it is a folder. */
  const covers = (path: string, candidate: string) =>
    candidate === path || candidate.startsWith(`${path}/`);

  return {
    list,

    create(input: Pick<Annotation, "path" | "anchor" | "comment" | "author">) {
      const now = Date.now();
      const annotation: Annotation = {
        id: newAnnotationId(),
        ...input,
        status: "open",
        createdAt: now,
        updatedAt: now,
      };
      return mutate(input.path, (annotations) => ({
        annotations: [...annotations, annotation],
        result: annotation,
      }));
    },

    /**
     * Applies `patch`. With `dropResolved`, an annotation that ends up
     * resolved is deleted instead and the result is its last state.
     */
    async update(
      id: string,
      patch: Partial<Pick<Annotation, "comment" | "status" | "resolution" | "sentTo">>,
      { dropResolved = false }: { dropResolved?: boolean } = {},
    ): Promise<Annotation> {
      const { path } = await find(id);
      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as typeof patch;
      return mutate(path, (annotations) => {
        const current = annotations.find((each) => each.id === id);
        if (current === undefined) throw new Error(`No annotation ${id}`);
        const updated: Annotation = { ...current, ...defined, updatedAt: Date.now() };
        const drop = dropResolved && updated.status === "resolved";
        return {
          annotations: drop
            ? annotations.filter((each) => each.id !== id)
            : annotations.map((each) => (each.id === id ? updated : each)),
          result: updated,
        };
      });
    },

    async remove(id: string): Promise<string> {
      const { path } = await find(id);
      await mutate(path, (annotations) => ({
        annotations: annotations.filter((each) => each.id !== id),
        result: undefined,
      }));
      return path;
    },

    /** Deletes the resolved annotations of these files; returns the files that had some. */
    async removeResolved(paths: Iterable<string>): Promise<string[]> {
      const changed: string[] = [];
      for (const path of new Set(paths)) {
        const had = await mutate(path, (annotations) => {
          const kept = annotations.filter((each) => each.status !== "resolved");
          return { annotations: kept, result: kept.length < annotations.length };
        });
        if (had) changed.push(path);
      }
      return changed;
    },

    /** Follows a file or folder move; returns the space paths whose annotations moved. */
    async move(from: string, to: string): Promise<string[]> {
      if (from === to || isMetaPath(from) || isMetaPath(to)) return [];
      const moved = (await annotatedPaths()).filter((path) => covers(from, path));
      for (const oldPath of moved) {
        const newPath = `${to}${oldPath.slice(from.length)}`;
        const { annotations } = await load(oldPath);
        await mutate(newPath, (existing) => ({
          annotations: [
            ...existing,
            ...annotations.map((annotation) => ({ ...annotation, path: newPath })),
          ],
          result: undefined,
        }));
        await removeFile(annotationFilePath(oldPath));
      }
      if (moved.length > 0) await removeFile(`${ANNOTATIONS_DIR}/${from}`);
      return moved.flatMap((oldPath) => [oldPath, `${to}${oldPath.slice(from.length)}`]);
    },

    /** Drops the annotations of a removed file or folder; returns the affected paths. */
    async removePath(path: string): Promise<string[]> {
      if (isMetaPath(path)) return [];
      const removed = (await annotatedPaths()).filter((each) => covers(path, each));
      for (const each of removed) await removeFile(annotationFilePath(each));
      if (removed.length > 0) await removeFile(`${ANNOTATIONS_DIR}/${path}`);
      return removed;
    },
  };
}

/** Publishes `space-annotations-changed` once per affected path. */
export function notifyAnnotations(
  bb: BbPluginApi,
  projectIdToNotify: string,
  paths: Iterable<string>,
): void {
  for (const path of new Set(paths)) {
    bb.realtime.publish(SPACE_ANNOTATIONS_CHANGED, { projectId: projectIdToNotify, path });
  }
}

/**
 * Keeps annotations with their file when `server/files.ts` moves or removes
 * it. Failures are logged, not thrown: the file operation already happened.
 */
export async function followFileChange(
  bb: BbPluginApi,
  space: ProjectSpace,
  change: { kind: "move"; from: string; to: string } | { kind: "remove"; path: string },
): Promise<void> {
  const store = annotationStore(bb.sdk.files, space);
  try {
    const paths =
      change.kind === "move"
        ? await store.move(change.from, change.to)
        : await store.removePath(change.path);
    notifyAnnotations(bb, space.projectId, paths);
  } catch (error) {
    bb.log.warn(`annotations did not follow ${change.kind}: ${String(error)}`);
  }
}

export const annotationsModule = defineModule({
  contract: annotationsContract,
  register({ bb, settings, resolveSpace }) {
    async function storeFor(id: string) {
      const space = await resolveSpace(id);
      return { space, store: annotationStore(bb.sdk.files, space) };
    }
    const dropResolved = async () => (await settings.get()).autoDeleteResolved;

    const rpc: PluginRpcHandlers<typeof annotationsContract> = {
      annotations_list: async ({ projectId: id, path }) => {
        const { space, store } = await storeFor(id);
        const annotations = await store.list(path);
        const resolved = annotations.filter((each) => each.status === "resolved");
        if (resolved.length === 0 || !(await dropResolved())) return { annotations };
        // Resolved before the setting was on, or by an older plugin: clean up now.
        notifyAnnotations(bb, space.projectId, await store.removeResolved(resolved.map((each) => each.path)));
        return { annotations: annotations.filter((each) => each.status !== "resolved") };
      },
      annotations_create: async ({ projectId: id, path, anchor, comment, author }) => {
        const { space, store } = await storeFor(id);
        const annotation = await store.create({ path, anchor, comment, author });
        notifyAnnotations(bb, space.projectId, [path]);
        return { annotation };
      },
      annotations_update: async ({ projectId: id, id: annotationId, ...patch }) => {
        const { space, store } = await storeFor(id);
        const annotation = await store.update(annotationId, patch, { dropResolved: await dropResolved() });
        notifyAnnotations(bb, space.projectId, [annotation.path]);
        return { annotation };
      },
      annotations_delete: async ({ projectId: id, id: annotationId }) => {
        const { space, store } = await storeFor(id);
        const path = await store.remove(annotationId);
        notifyAnnotations(bb, space.projectId, [path]);
        return { ok: true as const };
      },
    };

    return { rpc };
  },
});
