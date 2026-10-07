import { createHash } from "node:crypto";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin, { SPACE_CHANGED } from "../server/index";

const CHECKOUT = "/repo";
const ROOT = `${CHECKOUT}/.bb-space`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** The plugin on the fake host, with `bb.sdk.files` over a Map of absolute paths. */
async function load() {
  const disk = new Map<string, string>([[`${ROOT}/index.md`, "# Home\n"]]);
  const { bb, harness } = createFakePluginHost({
    pluginId: "project-space",
    sdk: {
      system: { config: async () => ({ primaryHostId: "other-host" }) },
      projects: {
        get: async () => ({
          id: "proj_1",
          name: "Demo",
          sources: [{ isDefault: true, path: `${CHECKOUT}/`, hostId: "host_1" }],
        }),
      },
      files: {
        read: async ({ path }: { path: string }) => {
          const content = disk.get(path);
          if (content === undefined) throw Object.assign(new Error(`HTTP 404: Path does not exist: ${path}`), { status: 404 });
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
      },
    } as never,
  });
  await plugin(bb);
  return { harness, disk };
}

type Harness = Awaited<ReturnType<typeof load>>["harness"];
const write = (harness: Harness, input: Record<string, unknown>) =>
  harness.callRpc("space_write", { projectId: "proj_1", ...input });

describe("space_write", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes inside the space and announces the change", async () => {
    const { harness, disk } = await load();
    const result = await write(harness, { path: "guides/new.md", content: "hi" });
    expect(result).toEqual({ outcome: "written", sha256: sha("hi") });
    expect(disk.get(`${ROOT}/guides/new.md`)).toBe("hi");
    const [call] = harness.sdk.callsTo("files.write") as [Record<string, unknown>][];
    expect(call[0]).toMatchObject({ hostId: "host_1", rootPath: ROOT, createParents: true });
    expect(call[0]).not.toHaveProperty("expectedSha256");

    await vi.advanceTimersByTimeAsync(300);
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: SPACE_CHANGED,
      payload: { projectId: "proj_1" },
    });
  });

  it("writes an edit whose sha matches", async () => {
    const { harness, disk } = await load();
    const result = await write(harness, { path: "index.md", content: "# New\n", expectedSha256: sha("# Home\n") });
    expect(result).toEqual({ outcome: "written", sha256: sha("# New\n") });
    expect(disk.get(`${ROOT}/index.md`)).toBe("# New\n");
  });

  it("reports a conflict for a stale sha and leaves the file alone", async () => {
    const { harness, disk } = await load();
    const result = await write(harness, { path: "index.md", content: "mine", expectedSha256: sha("older") });
    expect(result).toEqual({ outcome: "conflict", currentSha256: sha("# Home\n") });
    expect(disk.get(`${ROOT}/index.md`)).toBe("# Home\n");
    await vi.advanceTimersByTimeAsync(300);
    expect(harness.inspection.realtimeSignals).toEqual([]);
  });

  it("reports a conflict when create-only (null sha) meets an existing file", async () => {
    const { harness } = await load();
    expect(await write(harness, { path: "index.md", content: "x", expectedSha256: null })).toEqual({
      outcome: "conflict",
      currentSha256: sha("# Home\n"),
    });
    expect(await write(harness, { path: "fresh.md", content: "x", expectedSha256: null })).toEqual({
      outcome: "written",
      sha256: sha("x"),
    });
  });

  it.each([
    "../escape.md",
    "a/../../escape.md",
    "a/./b.md",
    "..\\escape.md",
    "a\0b.md",
    "",
    "/",
  ])("rejects the path %j before touching files", async (path) => {
    const { harness } = await load();
    await expect(write(harness, { path, content: "x" })).rejects.toThrow(/input validation/);
    expect(harness.sdk.callsTo("projects.get")).toEqual([]);
    expect(harness.sdk.callsTo("files.write")).toEqual([]);
  });

  it("normalizes slashes before writing", async () => {
    const { harness, disk } = await load();
    await write(harness, { path: "/guides//a.md/", content: "x" });
    expect(disk.has(`${ROOT}/guides/a.md`)).toBe(true);
  });
});

describe("space_read", () => {
  it("rejects traversal and reads normal paths", async () => {
    const { harness } = await load();
    await expect(harness.callRpc("space_read", { projectId: "proj_1", path: "../../etc/passwd" })).rejects.toThrow(/input validation/);
    expect(harness.sdk.callsTo("files.read")).toEqual([]);
    const file = await harness.callRpc("space_read", { projectId: "proj_1", path: "index.md" });
    expect(file).toMatchObject({ path: "index.md", content: "# Home\n", encoding: "utf8", modifiedAtMs: null });
  });
});
