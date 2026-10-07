// `space_worktrees` and `space_worktree_read`: the Space page shows the main
// checkout, so space files that threads changed in their own worktrees would
// go unnoticed. For each live worktree environment of the project, list the
// space files the worktree's branch changed (git's view since the merge base,
// committed or not) that still differ from the main space by sha256. A file
// the branch never touched is not listed even when main has moved on since.
// `space_worktree_copy` copies listed files into the main space, with
// compare-and-swap on both sides, so it never replaces an edit it did not show.
import { createHash } from "node:crypto";
import {
  defineRpcContract,
  type BbPluginApi,
  type PluginRpcHandlers,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { SPACE_DIR, normalizeSpacePath } from "../lib/space";
import {
  classifyChange,
  mainChangedSinceBase,
  spacePathOfRepoPath,
  type WorktreeChange,
} from "../lib/worktrees";
import { followFileChange } from "./annotations";
import { defineModule } from "./context";
import { absolute, checkoutOf, nonRootSpacePath, projectId, type ProjectSpace } from "./space";

const changeSchema = z.enum(["added", "modified", "deleted"]);

const worktreeSchema = z.object({
  environmentId: z.string(),
  branch: z.string().nullable(),
  threads: z.array(z.object({ id: z.string(), title: z.string() })),
  files: z.array(
    z.object({
      path: z.string(),
      change: changeSchema,
      /** The sha256 of each side when listed; null where the file is absent. */
      worktreeSha256: z.string().nullable(),
      mainSha256: z.string().nullable(),
      /**
       * True when the main space changed the file after the branch left it,
       * so a copy replaces that change. Null when git cannot say.
       */
      mainChanged: z.boolean().nullable(),
    }),
  ),
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
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const copyOutcomeSchema = z.enum(["copied", "conflict", "stale"]);

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
  space_worktree_copy: {
    input: z.object({
      projectId,
      environmentId,
      // The shas from the listing: a side that changed since is not touched.
      files: z
        .array(
          z.object({
            path: nonRootSpacePath,
            worktreeSha256: sha256.nullable(),
            mainSha256: sha256.nullable(),
          }),
        )
        .min(1)
        .max(100),
    }),
    output: z.object({
      files: z.array(z.object({ path: z.string(), outcome: copyOutcomeSchema })),
    }),
  },
});

const MAX_ENVIRONMENTS = 20;
const MAX_FILES = 100;
/** Without git (or when its diff fails), compare whole trees up to this size. */
const FALLBACK_FILE_LIMIT = 2000;
const CONCURRENCY = 4;
const THREAD_LIMIT = 10;
/** Kinds of change after which git has no file at the new path's merge base. */
const NEW_AT_PATH = new Set(["added", "copied", "renamed"]);

type Environment = Awaited<ReturnType<BbPluginApi["sdk"]["environments"]["list"]>>[number];

/** A worktree environment's space: where it is and which branch holds it. */
interface WorktreeSpace {
  env: Environment;
  checkout: string;
  rootPath: string;
}

/** What git says about the space files a worktree's branch touched. */
interface BranchCandidates {
  paths: string[];
  truncated: boolean;
  /** The merge base, to read the files as the branch found them. */
  mergeBaseRef: string | null;
  /** Repository path of each space path. */
  repoPaths: Map<string, string>;
  /** Space paths that did not exist at the merge base. */
  newPaths: Set<string>;
}

function trimSlashes(path: string): string {
  return path.replace(/\/+$/, "");
}

function shaOfContent(content: string, encoding: "utf8" | "base64"): string {
  return createHash("sha256").update(Buffer.from(content, encoding)).digest("hex");
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
  register({ bb, resolveSpace, notifyChanged }) {
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
    async function branchCandidates(env: Environment): Promise<BranchCandidates | null> {
      const mergeBaseBranch = env.mergeBaseBranch ?? env.baseBranch ?? env.defaultBranch;
      if (mergeBaseBranch === null) return null;
      try {
        const diff = await bb.sdk.environments.diffFiles({
          environmentId: env.id,
          target: "all",
          mergeBaseBranch,
        });
        if (diff.outcome !== "available") return null;
        const repoPaths = new Map<string, string>();
        const newPaths = new Set<string>();
        for (const file of diff.files) {
          for (const repoPath of [file.path, file.previousPath]) {
            if (repoPath === null) continue;
            const path = spacePathOfRepoPath(repoPath);
            if (path === null) continue;
            repoPaths.set(path, repoPath);
            if (repoPath === file.path && (file.origin === "untracked" || NEW_AT_PATH.has(file.changeKind))) {
              newPaths.add(path);
            }
          }
        }
        return {
          paths: [...repoPaths.keys()].sort(),
          truncated: diff.truncated,
          mergeBaseRef: diff.mergeBaseRef,
          repoPaths,
          newPaths,
        };
      } catch {
        return null;
      }
    }

    /**
     * The sha of a space file at the branch's merge base: null when it did
     * not exist there, undefined when git cannot say.
     */
    async function baseSha(
      env: Environment,
      candidates: BranchCandidates,
      path: string,
    ): Promise<string | null | undefined> {
      if (candidates.newPaths.has(path)) return null;
      const repoPath = candidates.repoPaths.get(path);
      if (candidates.mergeBaseRef === null || repoPath === undefined) return undefined;
      try {
        const file = await bb.sdk.environments.diffFile({
          environmentId: env.id,
          target: "all",
          mergeBaseRef: candidates.mergeBaseRef,
          path: repoPath,
          side: "old",
        });
        return shaOfContent(file.content, file.contentEncoding);
      } catch {
        return undefined;
      }
    }

    async function compare(space: ProjectSpace, worktree: WorktreeSpace): Promise<SpaceWorktree | null> {
      const { env } = worktree;
      const fromGit = await branchCandidates(env);
      if (fromGit !== null && fromGit.paths.length === 0) return null;
      if (!(await hasSpace(worktree))) return null;
      let candidates: { paths: string[]; truncated: boolean };
      if (fromGit === null) {
        // No git answer: every file on either side may differ.
        const [ours, theirs] = await Promise.all([
          spaceFiles(space.hostId, space.rootPath),
          spaceFiles(env.hostId, worktree.rootPath),
        ]);
        if (ours === null || theirs === null) return null;
        candidates = { paths: [...new Set([...ours, ...theirs])].sort(), truncated: false };
      } else {
        candidates = fromGit;
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
          batch.map(async (path): Promise<SpaceWorktree["files"][number] | null> => {
            const [theirs, ours] = await Promise.all([
              shaOf(env.hostId, worktree.rootPath, path),
              shaOf(space.hostId, space.rootPath, path),
            ]);
            const change: WorktreeChange | null = classifyChange(theirs, ours);
            if (change === null) return null;
            const base = fromGit === null ? undefined : await baseSha(env, fromGit, path);
            return {
              path,
              change,
              worktreeSha256: theirs,
              mainSha256: ours,
              mainChanged: mainChangedSinceBase(ours, base),
            };
          }),
        );
        for (const change of changes) {
          if (change !== null && files.length < MAX_FILES) files.push(change);
        }
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

    /** Calls in flight, so windows asking at once share one computation. */
    const inFlight = new Map<string, Promise<SpaceWorktreesOutput>>();

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

    function sharedWorktrees(id: string): Promise<SpaceWorktreesOutput> {
      const pending = inFlight.get(id);
      if (pending !== undefined) return pending;
      const result = worktrees(id).finally(() => inFlight.delete(id));
      inFlight.set(id, result);
      return result;
    }

    /** A worktree of the project as a space of its own, or an error. */
    async function worktreeOf(space: ProjectSpace, envId: string) {
      const env = await bb.sdk.environments.get({ environmentId: envId });
      if (env.projectId !== space.projectId || !env.isWorktree || env.path === null) {
        throw new Error(`Environment ${envId} is not a worktree of ${space.projectName}.`);
      }
      const checkout = trimSlashes(env.path);
      const worktreeSpace: ProjectSpace = { ...space, hostId: env.hostId, rootPath: `${checkout}/${SPACE_DIR}` };
      return { env, checkout, worktreeSpace };
    }

    type CopyRequest = { path: string; worktreeSha256: string | null; mainSha256: string | null };

    /** Copies one file's worktree state into the main space, if neither side moved. */
    async function copyOne(space: ProjectSpace, worktreeSpace: ProjectSpace, request: CopyRequest) {
      const { path } = request;
      let theirs: Awaited<ReturnType<BbPluginApi["sdk"]["files"]["read"]>> | null;
      try {
        theirs = await bb.sdk.files.read({
          hostId: worktreeSpace.hostId,
          path: absolute(worktreeSpace, path),
          rootPath: worktreeSpace.rootPath,
        });
      } catch {
        // A read error and a missing file look the same here; the sha check
        // below refuses a copy unless the listing also saw no file.
        theirs = null;
      }
      if ((theirs?.sha256 ?? null) !== request.worktreeSha256) return "stale" as const;
      if (theirs !== null) {
        const result = await bb.sdk.files.write({
          hostId: space.hostId,
          path: absolute(space, path),
          rootPath: space.rootPath,
          content: theirs.content,
          contentEncoding: theirs.contentEncoding,
          createParents: true,
          expectedSha256: request.mainSha256,
        });
        return result.outcome === "written" ? ("copied" as const) : ("conflict" as const);
      }
      // Deleted in the worktree: delete in main, unless main changed since.
      const ours = await shaOf(space.hostId, space.rootPath, path);
      if (ours !== request.mainSha256) return "conflict" as const;
      if (ours === null) return "copied" as const;
      await bb.sdk.files.remove({
        hostId: space.hostId,
        path: absolute(space, path),
        rootPath: space.rootPath,
        recursive: false,
      });
      await followFileChange(bb, space, { kind: "remove", path });
      return "copied" as const;
    }

    const rpc: PluginRpcHandlers<typeof worktreesContract> = {
      space_worktrees: ({ projectId: id }) => sharedWorktrees(id),
      space_worktree_copy: async ({ projectId: id, environmentId: envId, files }) => {
        const space = await resolveSpace(id);
        const { worktreeSpace } = await worktreeOf(space, envId);
        const results: { path: string; outcome: "copied" | "conflict" | "stale" }[] = [];
        // One at a time: a copy is rare, and the order of results is the order asked.
        for (const request of files) {
          results.push({ path: request.path, outcome: await copyOne(space, worktreeSpace, request) });
        }
        if (results.some((result) => result.outcome === "copied")) notifyChanged(space.projectId);
        return { files: results };
      },
      space_worktree_read: async ({ projectId: id, environmentId: envId, path }) => {
        const space = await resolveSpace(id);
        const { env, checkout, worktreeSpace } = await worktreeOf(space, envId);
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
