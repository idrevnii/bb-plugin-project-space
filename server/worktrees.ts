// `space_worktrees` and `space_worktree_read`: the Space page shows the main
// checkout, so space files that threads changed in their own worktrees would
// go unnoticed. For each live worktree environment of the project, list the
// space files the worktree's branch changed (git's view since the merge base,
// committed or not) that still differ from the main space by sha256. A file
// the branch never touched is not listed even when main has moved on since.
import {
  defineRpcContract,
  type BbPluginApi,
  type PluginRpcHandlers,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { SPACE_DIR, normalizeSpacePath } from "../lib/space";
import {
  classifyChange,
  spacePathOfRepoPath,
  type WorktreeChange,
} from "../lib/worktrees";
import { defineModule } from "./context";
import { absolute, checkoutOf, nonRootSpacePath, projectId, type ProjectSpace } from "./space";

const changeSchema = z.enum(["added", "modified", "deleted"]);

const worktreeSchema = z.object({
  environmentId: z.string(),
  branch: z.string().nullable(),
  threads: z.array(z.object({ id: z.string(), title: z.string() })),
  files: z.array(z.object({ path: z.string(), change: changeSchema })),
  /** True when more files changed than are listed. */
  truncated: z.boolean(),
});
export type SpaceWorktree = z.infer<typeof worktreeSchema>;

const worktreesOutputSchema = z.object({
  worktrees: z.array(worktreeSchema),
  /** True when the project has more live worktrees than were checked. */
  truncated: z.boolean(),
});
export type SpaceWorktreesOutput = z.infer<typeof worktreesOutputSchema>;

const environmentId = z.string().min(1).max(128);

export const worktreesContract = defineRpcContract({
  space_worktrees: {
    input: z.object({ projectId }),
    output: worktreesOutputSchema,
  },
  space_worktree_read: {
    input: z.object({ projectId, environmentId, path: nonRootSpacePath }),
    output: z.object({
      branch: z.string().nullable(),
      /** The worktree checkout and its host, for links out of the space. */
      checkoutPath: z.string(),
      hostId: z.string(),
      file: z.object({
        path: z.string(),
        content: z.string(),
        encoding: z.enum(["utf8", "base64"]),
        sha256: z.string(),
        sizeBytes: z.number(),
        modifiedAtMs: z.number().nullable(),
      }),
    }),
  },
});

const MAX_ENVIRONMENTS = 20;
const MAX_FILES = 100;
/** Without git (or when its diff fails), compare whole trees up to this size. */
const FALLBACK_FILE_LIMIT = 2000;
const CONCURRENCY = 4;
const CACHE_MS = 5000;
const THREAD_LIMIT = 10;

type Environment = Awaited<ReturnType<BbPluginApi["sdk"]["environments"]["list"]>>[number];

/** A worktree environment's space: where it is and which branch holds it. */
interface WorktreeSpace {
  env: Environment;
  checkout: string;
  rootPath: string;
}

function trimSlashes(path: string): string {
  return path.replace(/\/+$/, "");
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export const worktreesModule = defineModule({
  contract: worktreesContract,
  register({ bb, resolveSpace }) {
    /** Live worktrees of the project other than the main checkout, newest first. */
    async function liveWorktrees(space: ProjectSpace): Promise<WorktreeSpace[]> {
      const main = checkoutOf(space);
      const environments = await bb.sdk.environments.list({
        projectId: space.projectId,
        status: "ready",
      });
      return environments
        .filter(
          (env) =>
            env.isWorktree &&
            env.lifecycle.phase === "active" &&
            env.path !== null &&
            !(env.hostId === space.hostId && trimSlashes(env.path) === main),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((env) => {
          const checkout = trimSlashes(env.path ?? "");
          return { env, checkout, rootPath: `${checkout}/${SPACE_DIR}` };
        });
    }

    async function shaOf(hostId: string, rootPath: string, path: string): Promise<string | null> {
      try {
        const file = await bb.sdk.files.read({ hostId, path: `${rootPath}/${path}`, rootPath });
        return file.sha256;
      } catch {
        return null;
      }
    }

    async function hasSpace(worktree: WorktreeSpace): Promise<boolean> {
      try {
        const result = await bb.sdk.files.listPaths({
          hostId: worktree.env.hostId,
          path: worktree.checkout,
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

    async function spaceFiles(hostId: string, rootPath: string): Promise<string[] | null> {
      try {
        const result = await bb.sdk.files.listPaths({
          hostId,
          path: rootPath,
          includeFiles: true,
          includeDirectories: false,
          includeHidden: false,
          limit: FALLBACK_FILE_LIMIT,
        });
        if (result.truncated) return null;
        return result.paths
          .map((entry) => normalizeSpacePath(entry.path))
          .filter((path): path is string => path !== null && path !== "");
      } catch {
        return null;
      }
    }

    /**
     * Space paths the worktree's branch touched since its merge base, or
     * null when git cannot say (then every file is a candidate).
     */
    async function branchCandidates(env: Environment): Promise<{ paths: string[]; truncated: boolean } | null> {
      const mergeBaseBranch = env.mergeBaseBranch ?? env.baseBranch ?? env.defaultBranch;
      if (mergeBaseBranch === null) return null;
      try {
        const diff = await bb.sdk.environments.diffFiles({
          environmentId: env.id,
          target: "all",
          mergeBaseBranch,
        });
        if (diff.outcome !== "available") return null;
        const paths = new Set<string>();
        for (const file of diff.files) {
          for (const repoPath of [file.path, file.previousPath]) {
            if (repoPath === null) continue;
            const path = spacePathOfRepoPath(repoPath);
            if (path !== null) paths.add(path);
          }
        }
        return { paths: [...paths].sort(), truncated: diff.truncated };
      } catch {
        return null;
      }
    }

    async function compare(space: ProjectSpace, worktree: WorktreeSpace): Promise<SpaceWorktree | null> {
      const { env } = worktree;
      let candidates = await branchCandidates(env);
      if (candidates !== null && candidates.paths.length === 0) return null;
      if (!(await hasSpace(worktree))) return null;
      if (candidates === null) {
        // No git answer: every file on either side may differ.
        const [ours, theirs] = await Promise.all([
          spaceFiles(space.hostId, space.rootPath),
          spaceFiles(env.hostId, worktree.rootPath),
        ]);
        if (ours === null || theirs === null) return null;
        candidates = { paths: [...new Set([...ours, ...theirs])].sort(), truncated: false };
      }

      const files: SpaceWorktree["files"] = [];
      let truncated = candidates.truncated;
      for (let start = 0; start < candidates.paths.length; start += 8) {
        if (files.length >= MAX_FILES) {
          truncated = true;
          break;
        }
        const batch = candidates.paths.slice(start, start + 8);
        const changes = await Promise.all(
          batch.map(async (path): Promise<WorktreeChange | null> => {
            const [theirs, ours] = await Promise.all([
              shaOf(env.hostId, worktree.rootPath, path),
              shaOf(space.hostId, space.rootPath, path),
            ]);
            return classifyChange(theirs, ours);
          }),
        );
        batch.forEach((path, index) => {
          const change = changes[index];
          if (change != null && files.length < MAX_FILES) files.push({ path, change });
        });
      }
      if (files.length === 0) return null;

      let threads: SpaceWorktree["threads"] = [];
      try {
        const rows = await bb.sdk.threads.list({
          environmentId: env.id,
          archived: false,
          limit: THREAD_LIMIT,
        });
        threads = rows.map((thread) => ({
          id: thread.id,
          title: thread.title ?? thread.titleFallback ?? thread.id,
        }));
      } catch {
        threads = [];
      }
      return { environmentId: env.id, branch: env.branchName, threads, files, truncated };
    }

    const cache = new Map<string, { at: number; result: Promise<SpaceWorktreesOutput> }>();

    async function worktrees(id: string): Promise<SpaceWorktreesOutput> {
      const space = await resolveSpace(id);
      const all = await liveWorktrees(space);
      // The common case: no worktrees, so nothing else is read.
      if (all.length === 0) return { worktrees: [], truncated: false };
      const checked = all.slice(0, MAX_ENVIRONMENTS);
      const results = await mapLimited(checked, CONCURRENCY, (worktree) =>
        compare(space, worktree).catch((error: unknown) => {
          bb.log.warn(`space_worktrees: ${worktree.env.id}: ${String(error)}`);
          return null;
        }),
      );
      return {
        worktrees: results.filter((result): result is SpaceWorktree => result !== null),
        truncated: all.length > checked.length,
      };
    }

    function cachedWorktrees(id: string): Promise<SpaceWorktreesOutput> {
      const hit = cache.get(id);
      if (hit !== undefined && Date.now() - hit.at < CACHE_MS) return hit.result;
      const result = worktrees(id);
      cache.set(id, { at: Date.now(), result });
      result.catch(() => cache.delete(id));
      return result;
    }

    const rpc: PluginRpcHandlers<typeof worktreesContract> = {
      space_worktrees: ({ projectId: id }) => cachedWorktrees(id),
      space_worktree_read: async ({ projectId: id, environmentId: envId, path }) => {
        const space = await resolveSpace(id);
        const env = await bb.sdk.environments.get({ environmentId: envId });
        if (env.projectId !== space.projectId || !env.isWorktree || env.path === null) {
          throw new Error(`Environment ${envId} is not a worktree of ${space.projectName}.`);
        }
        const checkout = trimSlashes(env.path);
        const worktreeSpace: ProjectSpace = { ...space, hostId: env.hostId, rootPath: `${checkout}/${SPACE_DIR}` };
        const file = await bb.sdk.files.read({
          hostId: env.hostId,
          path: absolute(worktreeSpace, path),
          rootPath: worktreeSpace.rootPath,
        });
        return {
          branch: env.branchName,
          checkoutPath: checkout,
          hostId: env.hostId,
          file: {
            path,
            content: file.content,
            encoding: file.contentEncoding,
            sha256: file.sha256,
            sizeBytes: file.sizeBytes,
            modifiedAtMs: file.modifiedAtMs ?? null,
          },
        };
      },
    };

    return { rpc };
  },
});
