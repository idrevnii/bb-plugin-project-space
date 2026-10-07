import { describe, expect, it } from "vitest";
import {
  classifyChange,
  copySummary,
  mainChangedSinceBase,
  spacePathOfRepoPath,
  splitEnvQuery,
} from "../lib/worktrees";
import { parseRoute, routeSubPath } from "../ui/page/routing";

describe("spacePathOfRepoPath", () => {
  it("keeps files inside .bb-space, relative to it", () => {
    expect(spacePathOfRepoPath(".bb-space/roadmap.md")).toBe("roadmap.md");
    expect(spacePathOfRepoPath("docs/.bb-space/guides/a.md")).toBe("guides/a.md");
  });
  it("drops files outside the space, the folder itself, and hidden entries", () => {
    expect(spacePathOfRepoPath("server/index.ts")).toBeNull();
    expect(spacePathOfRepoPath(".bb-space")).toBeNull();
    expect(spacePathOfRepoPath(".bb-space/.space/annotations.json")).toBeNull();
  });
});

describe("classifyChange", () => {
  it("compares the worktree's sha with the main space's", () => {
    expect(classifyChange("a", "a")).toBeNull();
    expect(classifyChange(null, null)).toBeNull();
    expect(classifyChange("a", null)).toBe("added");
    expect(classifyChange(null, "a")).toBe("deleted");
    expect(classifyChange("a", "b")).toBe("modified");
  });
});

describe("env in the route", () => {
  it("splits a raw or encoded ?env= query", () => {
    expect(splitEnvQuery("proj/a.md?env=env_1")).toEqual({ rest: "proj/a.md", env: "env_1" });
    expect(splitEnvQuery("proj/a.md%3Fenv%3Denv_1")).toEqual({ rest: "proj/a.md", env: "env_1" });
    expect(splitEnvQuery("proj/a.md")).toEqual({ rest: "proj/a.md", env: null });
  });
  it("round-trips through routeSubPath and parseRoute", () => {
    const subPath = routeSubPath("proj_1", "guides/a b.md", "env_2");
    expect(parseRoute(subPath)).toEqual({ projectId: "proj_1", path: "guides/a b.md", env: "env_2" });
    expect(parseRoute(routeSubPath("proj_1", "a.md"))).toEqual({ projectId: "proj_1", path: "a.md", env: null });
  });
});

describe("mainChangedSinceBase", () => {
  it("compares main's sha with the merge base", () => {
    expect(mainChangedSinceBase("a", "a")).toBe(false);
    expect(mainChangedSinceBase(null, null)).toBe(false);
    expect(mainChangedSinceBase("b", "a")).toBe(true);
    expect(mainChangedSinceBase(null, "a")).toBe(true);
    expect(mainChangedSinceBase("a", undefined)).toBeNull();
  });
});

describe("copySummary", () => {
  it("counts each outcome", () => {
    expect(copySummary(["copied"])).toBe("Copied 1 file.");
    expect(copySummary(["copied", "copied", "conflict"])).toBe(
      "Copied 2 files. 1 file changed in the main space after the list was made. Nothing was copied over it.",
    );
    expect(copySummary(["stale", "stale"])).toBe(
      "2 files changed in the worktree after the list was made. Look again and copy them again.",
    );
  });
});
