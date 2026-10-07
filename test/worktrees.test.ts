import { describe, expect, it } from "vitest";
import { classifyChange, spacePathOfRepoPath, splitEnvQuery } from "../lib/worktrees";
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
