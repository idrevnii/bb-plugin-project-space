import { createHash } from "node:crypto";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "../server/index";

const MAIN = "/repo/.bb-space";
const WORKTREE = "/wt/.bb-space";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const worktreeEnv = {
  id: "env_wt",
  projectId: "proj_1",
  hostId: "host_1",
  path: "/wt",
  isWorktree: true,
  lifecycle: { phase: "active" },
  updatedAt: 1,
  branchName: "task/x",
  mergeBaseBranch: "main",
  baseBranch: "main",
  defaultBranch: "main",
};

/**
 * The plugin on the fake host, with one worktree. `disk` holds both spaces
 * by absolute path; `base` is the merge-base content by repository path.
 */
async function load(disk: Map<string, string>, base: Record<string, string>, diffFiles: object[]) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "project-space",
    sdk: {
      system: { config: async () => ({ primaryHostId: "other-host" }) },
      projects: {
        get: async () => ({
          id: "proj_1",
          name: "Demo",
          sources: [{ isDefault: true, path: "/repo/", hostId: "host_1" }],
        }),
      },
      environments: {
        list: async () => [worktreeEnv],
        get: async () => worktreeEnv,
        diffFiles: async () => ({ outcome: "available", files: diffFiles, truncated: false, mergeBaseRef: "abc" }),
        diffFile: async ({ path }: { path: string }) => {
          const content = base[path];
          if (content === undefined) throw new Error("no such file at the merge base");
          return { content, contentEncoding: "utf8", path, sizeBytes: content.length };
        },
      },
      threads: { list: async () => [{ id: "thr_1", title: "Task X" }] },
      files: {
        listPaths: async () => ({ paths: [{ path: ".bb-space", kind: "directory" }], truncated: false }),
        read: async ({ path }: { path: string }) => {
          const content = disk.get(path);
          if (content === undefined) throw Object.assign(new Error(`HTTP 404: ${path}`), { status: 404 });
          return { content, contentEncoding: "utf8", sha256: sha(content), sizeBytes: content.length };
        },
        write: async ({ path, content, expectedSha256 }: { path: string; content: string; expectedSha256?: string | null }) => {
          const current = disk.get(path);
          const currentSha256 = current === undefined ? null : sha(current);
          if (expectedSha256 !== undefined && expectedSha256 !== currentSha256) {
            return { outcome: "conflict", currentSha256 };
          }
          disk.set(path, content);
          return { outcome: "written", sha256: sha(content) };
        },
        remove: async ({ path }: { path: string }) => {
          disk.delete(path);
          return { ok: true };
        },
      },
    } as never,
  });
  await plugin(bb);
  return harness;
}

const changed = (path: string, changeKind = "modified", origin = "tracked") => ({
  path: `.bb-space/${path}`,
  previousPath: null,
  changeKind,
  origin,
});

describe("space_worktrees", () => {
  it("tells which files the main space changed too", async () => {
    const disk = new Map([
      [`${MAIN}/only-branch.md`, "base"],
      [`${WORKTREE}/only-branch.md`, "branch"],
      [`${MAIN}/both.md`, "main edit"],
      [`${WORKTREE}/both.md`, "branch edit"],
      [`${WORKTREE}/new.md`, "new"],
    ]);
    const harness = await load(
      disk,
      { ".bb-space/only-branch.md": "base", ".bb-space/both.md": "base" },
      [changed("only-branch.md"), changed("both.md"), changed("new.md", "added", "untracked")],
    );
    const result = (await harness.callRpc("space_worktrees", { projectId: "proj_1" })) as {
      worktrees: { files: { path: string; change: string; mainChanged: boolean | null }[] }[];
    };
    expect(result.worktrees[0]?.files).toEqual([
      { path: "both.md", change: "modified", worktreeSha256: sha("branch edit"), mainSha256: sha("main edit"), mainChanged: true },
      { path: "new.md", change: "added", worktreeSha256: sha("new"), mainSha256: null, mainChanged: false },
      { path: "only-branch.md", change: "modified", worktreeSha256: sha("branch"), mainSha256: sha("base"), mainChanged: false },
    ]);
  });

  it("says unknown when git cannot read the merge base", async () => {
    const disk = new Map([
      [`${MAIN}/a.md`, "main"],
      [`${WORKTREE}/a.md`, "branch"],
    ]);
    const harness = await load(disk, {}, [changed("a.md")]);
    const result = (await harness.callRpc("space_worktrees", { projectId: "proj_1" })) as {
      worktrees: { files: { mainChanged: boolean | null }[] }[];
    };
    expect(result.worktrees[0]?.files[0]?.mainChanged).toBeNull();
  });
});

describe("space_worktree_copy", () => {
  const copy = (harness: Awaited<ReturnType<typeof load>>, files: object[]) =>
    harness.callRpc("space_worktree_copy", { projectId: "proj_1", environmentId: "env_wt", files }) as Promise<{
      files: { path: string; outcome: string }[];
    }>;

  it("copies added and modified files, and deletes what the worktree deleted", async () => {
    const disk = new Map([
      [`${WORKTREE}/new.md`, "new"],
      [`${MAIN}/edit.md`, "old"],
      [`${WORKTREE}/edit.md`, "edited"],
      [`${MAIN}/gone.md`, "gone"],
    ]);
    const harness = await load(disk, {}, []);
    const result = await copy(harness, [
      { path: "new.md", worktreeSha256: sha("new"), mainSha256: null },
      { path: "edit.md", worktreeSha256: sha("edited"), mainSha256: sha("old") },
      { path: "gone.md", worktreeSha256: null, mainSha256: sha("gone") },
    ]);
    expect(result.files.map((file) => file.outcome)).toEqual(["copied", "copied", "copied"]);
    expect(disk.get(`${MAIN}/new.md`)).toBe("new");
    expect(disk.get(`${MAIN}/edit.md`)).toBe("edited");
    expect(disk.has(`${MAIN}/gone.md`)).toBe(false);
  });

  it("leaves main alone when main changed after the listing", async () => {
    const disk = new Map([
      [`${MAIN}/edit.md`, "newer main"],
      [`${WORKTREE}/edit.md`, "edited"],
      [`${MAIN}/gone.md`, "newer main"],
    ]);
    const harness = await load(disk, {}, []);
    const result = await copy(harness, [
      { path: "edit.md", worktreeSha256: sha("edited"), mainSha256: sha("old") },
      { path: "gone.md", worktreeSha256: null, mainSha256: sha("gone") },
    ]);
    expect(result.files.map((file) => file.outcome)).toEqual(["conflict", "conflict"]);
    expect(disk.get(`${MAIN}/edit.md`)).toBe("newer main");
    expect(disk.get(`${MAIN}/gone.md`)).toBe("newer main");
  });

  it("copies nothing when the worktree changed after the listing", async () => {
    const disk = new Map([
      [`${MAIN}/edit.md`, "old"],
      [`${WORKTREE}/edit.md`, "edited again"],
    ]);
    const harness = await load(disk, {}, []);
    const result = await copy(harness, [{ path: "edit.md", worktreeSha256: sha("edited"), mainSha256: sha("old") }]);
    expect(result.files[0]?.outcome).toBe("stale");
    expect(disk.get(`${MAIN}/edit.md`)).toBe("old");
  });

  it("refuses an environment of another project", async () => {
    const harness = await load(new Map(), {}, []);
    worktreeEnv.projectId = "proj_2";
    try {
      await expect(copy(harness, [{ path: "a.md", worktreeSha256: null, mainSha256: null }])).rejects.toThrow(
        /not a worktree/,
      );
    } finally {
      worktreeEnv.projectId = "proj_1";
    }
  });
});
