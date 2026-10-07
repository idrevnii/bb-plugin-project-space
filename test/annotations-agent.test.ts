import { createHash } from "node:crypto";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  MAX_OUTPUT_BYTES,
  filterAnnotations,
  listJson,
  listText,
  quoteContext,
  showText,
} from "../lib/annotation-text";
import type { Anchor, Annotation } from "../lib/annotations";
import plugin from "../server/index";

const ROOT = "/repo/.bb-space";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

let clock = 0;
function annotation(id: string, path: string, comment: string, anchor: Anchor = { kind: "file" }, status: Annotation["status"] = "open"): Annotation {
  clock += 1;
  return { id, path, anchor, comment, status, author: "user", createdAt: clock, updatedAt: clock };
}

const PAGE = ["# Title", "", "one", "two", "three", "The quick brown fox jumps.", "four", "five", "six", "seven"].join("\n");
const fox: Anchor = { kind: "text-quote", exact: "quick brown fox", prefix: "The ", suffix: " jumps." };

describe("annotation text", () => {
  it("orders by file with open first and filters by path and status", () => {
    const a = annotation("ann_a", "b.md", "A", undefined, "resolved");
    const b = annotation("ann_b", "b.md", "B");
    const c = annotation("ann_c", "a.md", "C", undefined, "sent");
    expect(filterAnnotations([a, b, c], {}).map((each) => each.id)).toEqual(["ann_b", "ann_a", "ann_c"]);
    expect(filterAnnotations([a, b, c], { path: "b.md", status: "resolved" }).map((each) => each.id)).toEqual(["ann_a"]);
  });

  it("prints one line per annotation", () => {
    expect(listText([annotation("ann_x", "index.md", "Say\nmore", fox)])).toBe(
      "ann_x  open      index.md — «quick brown fox» → Say more",
    );
    expect(listText([])).toBe("No annotations.");
  });

  it("finds the quote's lines with three lines of context", () => {
    const context = quoteContext(PAGE, annotation("ann_x", "p.md", "c", fox));
    expect(context).toEqual({
      firstLine: 3,
      quoteLines: [6, 6],
      lines: ["one", "two", "three", "The quick brown fox jumps.", "four", "five", "six"],
    });
  });

  it("shows the comment, the quote and where it is now", () => {
    const moved = `intro\n\n${PAGE}`;
    const text = showText({ ...annotation("ann_x", "p.md", "Name the fox", fox), resolution: "Which fox?" }, moved);
    expect(text).toContain("Comment:\n  Name the fox");
    expect(text).toContain("Reply:\n  Which fox?");
    expect(text).toContain("Now at line 8:");
    expect(text).toContain("> 8 | The quick brown fox jumps.");
    expect(text).toContain("  5 | one");
  });

  it("says when the quote or the file is gone", () => {
    const a = annotation("ann_x", "p.md", "c", fox);
    expect(showText(a, "nothing like it")).toContain("orphaned");
    expect(showText(a, null)).toContain("cannot be read");
    expect(showText(annotation("ann_y", "c.tldr", "c", { kind: "shapes", shapeIds: ["shape:a"] }), null)).toContain(
      "bb space canvas c.tldr",
    );
  });

  it("stays under the output limit for many long annotations", () => {
    const long = "é".repeat(4000);
    const many = Array.from({ length: 2000 }, (_, index) =>
      annotation(`ann_${index}`, `pages/${index}.md`, long, { kind: "text-quote", exact: long, prefix: "", suffix: "" }),
    );
    const text = listText(many);
    expect(Buffer.byteLength(text)).toBeLessThan(MAX_OUTPUT_BYTES);
    expect(text).toMatch(/… \d+ more not shown/);
    const json = listJson(many);
    expect(Buffer.byteLength(json)).toBeLessThan(MAX_OUTPUT_BYTES);
    expect(JSON.parse(json)).toMatchObject({ total: 2000, truncated: true });
    const shown = showText({ ...many[0]!, resolution: long }, `${"x".repeat(100_000)}\n${long}\n${"y".repeat(100_000)}`);
    expect(Buffer.byteLength(shown)).toBeLessThan(MAX_OUTPUT_BYTES);
  });
});

/** The plugin on the fake host, files over a Map. */
async function load() {
  const disk = new Map<string, string>();
  const { bb, harness } = createFakePluginHost({
    pluginId: "project-space",
    sdk: {
      system: { config: async () => ({ primaryHostId: "other-host" }) },
      projects: {
        get: async () => ({ id: "proj_1", name: "Demo", sources: [{ isDefault: true, path: "/repo/", hostId: "host_1" }] }),
      },
      files: {
        read: async ({ path }: { path: string }) => {
          const content = disk.get(path);
          if (content === undefined) throw Object.assign(new Error(`HTTP 404: Path does not exist: ${path}`), { status: 404 });
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
  disk.set(`${ROOT}/p.md`, PAGE);
  const created = (await harness.callRpc("annotations_create", {
    projectId: "proj_1",
    path: "p.md",
    anchor: fox,
    comment: "Name the fox",
  })) as { annotation: Annotation };
  const cli = (...argv: string[]) => harness.runCli(["annotations", ...argv], { projectId: "proj_1" });
  const tool = (input: object) => harness.callAgentTool("space_annotations", input, { projectId: "proj_1" });
  return { harness, cli, tool, disk, id: created.annotation.id };
}

const textOf = (result: unknown) =>
  typeof result === "string" ? result : (result as { content: { text?: string }[] }).content[0]!.text!;

describe("bb space annotations", () => {
  it("lists, shows, replies and resolves, publishing each change", async () => {
    const { harness, cli, id } = await load();

    expect((await cli("list")).stdout).toBe(`${id}  open      p.md — «quick brown fox» → Name the fox`);
    expect((await cli("list", "--status", "resolved")).stdout).toBe("No annotations.");
    expect(JSON.parse((await cli("list", "--path", "p.md", "--json")).stdout)).toMatchObject({
      total: 1,
      truncated: false,
      annotations: [{ id, status: "open" }],
    });

    const shown = (await cli("show", id)).stdout;
    expect(shown).toContain("Now at line 6:");
    expect(shown).toContain(">6 | The quick brown fox jumps.");

    const before = harness.realtimeSignals.length;
    expect((await cli("reply", id, "Which", "fox?")).stdout).toBe(`Replied on ${id} (open).`);
    expect((await cli("show", id)).stdout).toContain("Reply:\n  Which fox?");

    expect((await cli("resolve", id)).stdout).toBe(`Resolved ${id} on p.md.`);
    const resolved = JSON.parse((await cli("list", "--json")).stdout).annotations[0];
    expect(resolved).toMatchObject({ status: "resolved", resolution: "Which fox?" });
    await cli("resolve", id, "--note", "Named it Rex");
    expect((await cli("show", id)).stdout).toContain("Resolution:\n  Named it Rex");
    expect(harness.realtimeSignals.length - before).toBe(3);
  });

  it("fails cleanly on an unknown id or a bad path", async () => {
    const { cli } = await load();
    const missing = await cli("show", "ann_nope");
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stderr).toContain("No annotation ann_nope");
    expect((await cli("resolve", "ann_nope")).exitCode).not.toBe(0);
    expect((await cli("list", "--path", "../x")).exitCode).not.toBe(0);
  });
});

describe("space_annotations tool", () => {
  it("lists, shows and resolves", async () => {
    const { tool, id } = await load();
    expect(textOf(await tool({ action: "list", status: "open" }))).toContain(id);
    expect(textOf(await tool({ action: "show", id }))).toContain(">6 | The quick brown fox jumps.");
    expect(textOf(await tool({ action: "resolve", id, note: "Done" }))).toBe(`Resolved ${id} on p.md.`);
    expect(textOf(await tool({ action: "list", status: "open" }))).toBe("No annotations.");
  });

  it("asks for an id", async () => {
    const { tool } = await load();
    const result = (await tool({ action: "show" })) as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("needs an id");
  });
});

describe("reading a canvas with comments", () => {
  const CANVAS = JSON.stringify({
    tldrawFileFormatVersion: 1,
    records: [{ typeName: "shape", id: "shape:node-api", type: "geo", x: 0, y: 0, props: { geo: "rectangle", w: 100, h: 50 } }],
  });

  it("prints the comment under its shape in `bb space canvas` and space_canvas_read", async () => {
    const { harness, disk } = await load();
    disk.set(`${ROOT}/c.tldr`, CANVAS);
    const { annotation } = (await harness.callRpc("annotations_create", {
      projectId: "proj_1",
      path: "c.tldr",
      anchor: { kind: "shapes", shapeIds: ["shape:node-api"] },
      comment: "Rename to gateway",
    })) as { annotation: Annotation };
    const line = `    ↳ comment ${annotation.id} [open]: "Rename to gateway"`;
    const cli = (await harness.runCli(["canvas", "c.tldr"], { projectId: "proj_1" })).stdout;
    expect(cli.split("\n")).toContain(line);
    expect(cli.split("\n").indexOf(line) - 1).toBe(cli.split("\n").findIndex((each) => each.startsWith('- id "api"')));
    const tool = textOf(await harness.callAgentTool("space_canvas_read", { path: "c.tldr" }, { projectId: "proj_1" }));
    expect(tool).toContain(line);
  });

  it("still describes the canvas when its annotation file is broken", async () => {
    const { harness, disk } = await load();
    disk.set(`${ROOT}/c.tldr`, CANVAS);
    disk.set(`${ROOT}/.space/annotations/c.tldr.json`, "{broken");
    const out = (await harness.runCli(["canvas", "c.tldr"], { projectId: "proj_1" })).stdout;
    expect(out).toContain('- id "api"');
    expect(out).toContain("Its comments could not be read: Annotation file for c.tldr is unreadable");
  });
});
