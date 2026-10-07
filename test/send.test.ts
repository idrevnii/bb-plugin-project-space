import { createHash } from "node:crypto";
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import type { Annotation } from "../lib/annotations";
import { reviewMessage } from "../lib/review";
import plugin from "../server/index";

const ROOT = "/repo/.bb-space";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** The plugin on the fake host: files over a Map, threads `thr_here` (this project) and `thr_away`. */
async function load() {
  const disk = new Map<string, string>();
  const sent: unknown[] = [];
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
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({
          id: threadId,
          projectId: threadId === "thr_here" ? "proj_1" : "proj_2",
        }),
        send: async (args: unknown) => {
          sent.push(args);
          return { delivery: "dispatched" };
        },
      },
      files: {
        read: async ({ path }: { path: string }) => {
          const content = disk.get(path);
          if (content === undefined) throw new Error(`ENOENT ${path}`);
          return { content, contentEncoding: "utf8", sha256: sha(content) };
        },
        write: async ({ path, content, expectedSha256 }: { path: string; content: string; expectedSha256?: string | null }) => {
          const current = disk.get(path);
          const currentSha256 = current === undefined ? null : sha(current);
          if (expectedSha256 !== undefined && expectedSha256 !== currentSha256) return { outcome: "conflict", currentSha256 };
          disk.set(path, content);
          return { outcome: "written", sha256: sha(content) };
        },
        listPaths: async ({ path }: { path: string }) => ({
          paths: [...disk.keys()]
            .filter((key) => key.startsWith(`${path}/`))
            .map((key) => ({ path: key.slice(path.length + 1), kind: "file" })),
          truncated: false,
        }),
        remove: async () => ({ ok: true }),
      },
    } as never,
  });
  await plugin(bb);
  const call = <T>(method: string, input: Record<string, unknown>) =>
    harness.callRpc(method, { projectId: "proj_1", ...input }) as Promise<T>;
  const create = async (path: string, comment: string) =>
    (await call<{ annotation: Annotation }>("annotations_create", { path, anchor: { kind: "file" }, comment })).annotation;
  const list = async () => (await call<{ annotations: Annotation[] }>("annotations_list", {})).annotations;
  return { harness, sent, call, create, list };
}

describe("annotations_send", () => {
  it("posts the review message to the thread and marks the annotations sent", async () => {
    const { sent, call, create, list } = await load();
    const a = await create("index.md", "Tighten the intro");
    const b = await create("guides/x.md", "Add an example");
    const result = await call<{ sent: number; text: string }>("annotations_send", { ids: [a.id, b.id], threadId: "thr_here" });
    expect(result.sent).toBe(2);
    expect(result.text).toBe(reviewMessage([a, b]));
    expect(sent).toEqual([
      { threadId: "thr_here", mode: "auto", input: [{ type: "text", text: result.text, mentions: [] }] },
    ]);
    for (const each of await list()) {
      expect(each.status).toBe("sent");
      expect(each.sentTo?.threadId).toBe("thr_here");
    }
  });

  it("refuses a thread of another project and unknown ids, sending nothing", async () => {
    const { sent, call, create } = await load();
    const a = await create("index.md", "x");
    await expect(call("annotations_send", { ids: [a.id], threadId: "thr_away" })).rejects.toThrow(/not in this project/);
    await expect(call("annotations_send", { ids: ["ann_missing"], threadId: "thr_here" })).rejects.toThrow(/No annotation ann_missing/);
    expect(sent).toEqual([]);
  });
});

describe("the message.dispatch hook", () => {
  it("proceeds at once and marks the annotations of a review message sent", async () => {
    const { harness, create, list } = await load();
    const open = await create("index.md", "one");
    const other = await create("index.md", "two");
    const hook = harness.inspection.registrations.hooks["message.dispatch"]!;
    const decision = await hook(
      makeMessageDispatchHookContext({
        thread: { id: "thr_new" },
        project: { id: "proj_1" },
        input: { text: reviewMessage([open]) },
      }),
    );
    expect(decision).toEqual({ action: "proceed" });
    await vi.waitFor(async () => expect((await list()).find((each) => each.id === open.id)?.status).toBe("sent"));
    const after = await list();
    expect(after.find((each) => each.id === open.id)?.sentTo?.threadId).toBe("thr_new");
    expect(after.find((each) => each.id === other.id)?.status).toBe("open");
  });

  it("ignores ordinary messages and leaves resolved annotations resolved", async () => {
    const { harness, call, create, list } = await load();
    const done = await create("index.md", "done");
    await call("annotations_update", { id: done.id, status: "resolved" });
    const hook = harness.inspection.registrations.hooks["message.dispatch"]!;
    const context = (text: string) =>
      makeMessageDispatchHookContext({ thread: { id: "thr_new" }, project: { id: "proj_1" }, input: { text } });
    expect(await hook(context(`see [${done.id}]`))).toEqual({ action: "proceed" });
    expect(await hook(context(reviewMessage([done])))).toEqual({ action: "proceed" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await list())[0]?.status).toBe("resolved");
  });
});
