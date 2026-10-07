import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { annotationStore } from "../server/annotations";
import type { ProjectSpace } from "../server/space";

const ROOT = "/repo/.bb-space";
const space: ProjectSpace = {
  projectId: "proj_test",
  projectName: "Test",
  hostId: "host",
  rootPath: ROOT,
  isLocal: true,
};

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Enough of bb.sdk.files over a Map of absolute path → content. */
function memoryFiles() {
  const disk = new Map<string, string>();
  const files = {
    async read({ path }: { path: string }) {
      const content = disk.get(path);
      if (content === undefined) throw Object.assign(new Error(`HTTP 404: Path does not exist: ${path}`), { status: 404 });
      return { content, contentEncoding: "utf8", sha256: sha(content) };
    },
    async write({ path, content, expectedSha256 }: { path: string; content: string; expectedSha256?: string | null }) {
      const current = disk.get(path);
      const currentSha = current === undefined ? null : sha(current);
      if (expectedSha256 !== undefined && expectedSha256 !== currentSha) {
        return { outcome: "conflict", currentSha256: currentSha };
      }
      disk.set(path, content);
      return { outcome: "written", sha256: sha(content) };
    },
    async listPaths({ path }: { path: string }) {
      const prefix = `${path}/`;
      return {
        paths: [...disk.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({ path: key.slice(prefix.length), kind: "file" })),
        truncated: false,
      };
    },
    async remove({ path }: { path: string }) {
      for (const key of [...disk.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) disk.delete(key);
      }
      return { ok: true };
    },
  };
  return { disk, files, store: annotationStore(files as never, space) };
}

const quote = { kind: "text-quote", exact: "route back", prefix: "an explicit ", suffix: " to an agent" } as const;

describe("annotationStore", () => {
  it("creates, lists, updates and deletes", async () => {
    const { disk, store } = memoryFiles();
    const a = await store.create({ path: "guides/a.md", anchor: quote, comment: "Clarify", author: "user" });
    const b = await store.create({ path: "index.md", anchor: { kind: "file" }, comment: "Whole page", author: "agent" });
    expect(a.id).toMatch(/^ann_/);
    expect(a.status).toBe("open");
    expect(disk.has(`${ROOT}/.space/annotations/guides/a.md.json`)).toBe(true);

    expect((await store.list()).map((each) => each.id)).toEqual([a.id, b.id]);
    expect((await store.list("index.md")).map((each) => each.id)).toEqual([b.id]);
    expect(await store.list("missing.md")).toEqual([]);

    const sent = await store.update(a.id, { status: "sent", sentTo: { threadId: "thr_1", at: 1 } });
    expect(sent).toMatchObject({ status: "sent", comment: "Clarify", sentTo: { threadId: "thr_1" } });
    const resolved = await store.update(a.id, { status: "resolved", resolution: "Done", comment: undefined });
    expect(resolved).toMatchObject({ status: "resolved", resolution: "Done", comment: "Clarify" });

    expect(await store.remove(a.id)).toBe("guides/a.md");
    expect((await store.list()).map((each) => each.id)).toEqual([b.id]);
    await expect(store.update(a.id, { comment: "x" })).rejects.toThrow(/No annotation/);
  });

  it("reads a missing annotation file as none, but fails on any other read error", async () => {
    const { disk, files, store } = memoryFiles();
    expect(await store.list("missing.md")).toEqual([]);
    disk.set(`${ROOT}/.space/annotations/a.md.json`, "{}");
    files.read = async () => {
      throw Object.assign(new Error("HTTP 403: Permission denied"), { status: 403 });
    };
    await expect(store.list("a.md")).rejects.toThrow("Annotation file for a.md could not be read: Error: HTTP 403");
  });

  it("retries a write that lost a compare-and-swap race", async () => {
    const { disk, store } = memoryFiles();
    const first = await store.create({ path: "a.md", anchor: { kind: "file" }, comment: "one", author: "user" });
    const file = `${ROOT}/.space/annotations/a.md.json`;
    // Another writer sneaks in between our read and our write once.
    const original = disk.get.bind(disk);
    let raced = false;
    disk.get = (key: string) => {
      const value = original(key);
      if (key === file && !raced && value !== undefined) {
        raced = true;
        const doc = JSON.parse(value);
        doc.annotations.push({ ...doc.annotations[0], id: "ann_other" });
        disk.set(key, JSON.stringify(doc));
      }
      return value;
    };
    const second = await store.create({ path: "a.md", anchor: { kind: "file" }, comment: "two", author: "user" });
    expect((await store.list("a.md")).map((each) => each.id)).toEqual([first.id, "ann_other", second.id]);
  });

  it("follows a file move and a folder move", async () => {
    const { store } = memoryFiles();
    const a = await store.create({ path: "notes/a.md", anchor: quote, comment: "A", author: "user" });
    await store.create({ path: "notes/deep/b.md", anchor: { kind: "file" }, comment: "B", author: "user" });

    expect(await store.move("notes/a.md", "notes/renamed.md")).toEqual(["notes/a.md", "notes/renamed.md"]);
    expect(await store.list("notes/a.md")).toEqual([]);
    expect((await store.list("notes/renamed.md"))[0]).toMatchObject({ id: a.id, path: "notes/renamed.md" });

    await store.move("notes", "archive");
    expect((await store.list()).map((each) => each.path).sort()).toEqual(["archive/deep/b.md", "archive/renamed.md"]);
    // A sibling whose name only starts with the folder name is untouched.
    await store.create({ path: "notes2.md", anchor: { kind: "file" }, comment: "C", author: "user" });
    expect(await store.move("notes", "elsewhere")).toEqual([]);
  });

  it("drops annotations of a removed file or folder", async () => {
    const { store } = memoryFiles();
    await store.create({ path: "x/a.md", anchor: { kind: "file" }, comment: "A", author: "user" });
    await store.create({ path: "x/b.md", anchor: { kind: "file" }, comment: "B", author: "user" });
    await store.create({ path: "y.md", anchor: { kind: "file" }, comment: "C", author: "user" });
    expect(await store.removePath("x/a.md")).toEqual(["x/a.md"]);
    expect(await store.removePath("x")).toEqual(["x/b.md"]);
    expect((await store.list()).map((each) => each.path)).toEqual(["y.md"]);
  });
});
