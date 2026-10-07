import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canvasImageModule } from "../server/canvas-image";
import type { ServerContext } from "../server/context";
import { drawModule } from "../server/draw";
import type { ProjectSpace } from "../server/space";

const ROOT = "/repo/.bb-space";
const PATH = "diagram.tldr";
const space: ProjectSpace = {
  projectId: "proj_test",
  projectName: "Test",
  hostId: "host",
  rootPath: ROOT,
  isLocal: true,
};

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

type ToolResult = { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean };
type Tool = { name: string; execute: (args: unknown, ctx: unknown) => Promise<ToolResult | string> };

/** Both modules over an in-memory database and a Map of files. */
function setup() {
  const disk = new Map<string, string>();
  const db = new Database(":memory:");
  const tools = new Map<string, Tool>();
  const published: unknown[] = [];
  const written = new Map<string, string>();
  const bb = {
    storage: {
      database: () => db,
      migrate: (target: Database.Database, statements: string[]) => {
        for (const statement of statements) target.exec(statement);
      },
    },
    agents: { registerTool: (tool: Tool) => tools.set(tool.name, tool) },
    realtime: { publish: (_channel: string, payload: unknown) => published.push(payload) },
    sdk: {
      files: {
        async read({ path }: { path: string }) {
          const content = disk.get(path);
          if (content === undefined) throw new Error(`ENOENT ${path}`);
          return { content, contentEncoding: "utf8", sha256: sha(content) };
        },
        async write({ path, content }: { path: string; content: string }) {
          written.set(path, content);
          return { outcome: "written", sha256: sha(content) };
        },
      },
    },
  };
  const ctx = {
    bb,
    settings: { get: async () => ({ tldrawLicenseKey: "" }) },
    resolveSpace: async () => space,
    readText: async (_space: ProjectSpace, path: string) => disk.get(`${ROOT}/${path}`) ?? null,
    notifyChanged: () => {},
    spaceExists: async () => true,
    ensureWatcher: () => true,
  } as unknown as ServerContext;
  const draw = drawModule.register(ctx);
  const image = canvasImageModule.register(ctx);
  const view = (path = PATH) =>
    tools.get("space_canvas_view")!.execute({ path }, { projectId: space.projectId }) as Promise<ToolResult>;
  const pending = () =>
    draw.rpc.space_draw_pending({ projectId: space.projectId, path: PATH }) as {
      batches: Array<{ id: number; spec: string }>;
    };
  const put = (content: string, pngBase64: string) =>
    image.rpc.space_canvas_image_put(
      { projectId: space.projectId, path: PATH, sha256: sha(content), pngBase64 },
    );
  return { disk, view, pending, put, published, draw, written };
}

const DOC = '{"tldrawFileFormatVersion":1,"records":[]}';

afterEach(() => {
  vi.useRealTimers();
});

describe("space_canvas_view", () => {
  it("returns the stored picture when it matches the file", async () => {
    const { disk, view, put, pending } = setup();
    disk.set(`${ROOT}/${PATH}`, DOC);
    put(DOC, "iVBORw0KGgo=");
    const result = await view();
    expect(result.isError).toBeUndefined();
    expect(result.content[1]).toMatchObject({ type: "image", data: "iVBORw0KGgo=" });
    expect(pending().batches).toHaveLength(0);
  });

  it("asks a renderer for a fresh picture when the stored one is stale", async () => {
    const { disk, view, put, pending, published } = setup();
    disk.set(`${ROOT}/${PATH}`, DOC);
    put("an older version", "b2xk");
    const result = view();
    await vi.waitFor(() => expect(pending().batches).toHaveLength(1));
    expect(pending().batches[0]!.spec).toBe("{}");
    expect(published).toContainEqual({ projectId: space.projectId, path: PATH });
    put(DOC, "bmV3");
    expect((await result).content[1]).toMatchObject({ type: "image", data: "bmV3" });
  });

  it("gives up after 12 s with a message and leaves no request behind", async () => {
    vi.useFakeTimers();
    const { disk, view, pending } = setup();
    disk.set(`${ROOT}/${PATH}`, DOC);
    const result = view();
    await vi.advanceTimersByTimeAsync(12_500);
    const settled = await result;
    expect(settled.isError).toBe(true);
    expect(settled.content[0]!.text).toMatch(/No bb window rendered diagram\.tldr within 12 s/);
    expect(pending().batches).toHaveLength(0);
  });

  it("says so for a missing or empty canvas without waiting", async () => {
    const { disk, view, pending } = setup();
    expect((await view()).content[0]!.text).toMatch(/does not exist/);
    disk.set(`${ROOT}/${PATH}`, "");
    expect((await view()).content[0]!.text).toMatch(/empty canvas/);
    expect(pending().batches).toHaveLength(0);
  });
});

describe("bb space canvas --png", () => {
  const run = (draw: ReturnType<typeof setup>["draw"], png: string) =>
    draw.cli!.canvas!.run(
      { positionals: { path: PATH }, options: { png } } as never,
      { projectId: space.projectId, cwd: "/repo" } as never,
    );

  it("writes the picture to the invoker's path", async () => {
    const { disk, put, draw, written } = setup();
    disk.set(`${ROOT}/${PATH}`, DOC);
    put(DOC, "iVBORw0KGgo=");
    const output = (await run(draw, "out/canvas.png")) as { stdout: string };
    expect(output.stdout).toContain("/repo/out/canvas.png");
    expect(written.get("/repo/out/canvas.png")).toBe("iVBORw0KGgo=");
  });

  it("refuses to write into .bb-space", async () => {
    const { disk, put, draw, written } = setup();
    disk.set(`${ROOT}/${PATH}`, DOC);
    put(DOC, "iVBORw0KGgo=");
    await expect(run(draw, ".bb-space/canvas.png")).rejects.toThrow(/not written into the space/);
    expect(written.size).toBe(0);
  });
});
