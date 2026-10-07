import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
function setup(rootPath = ROOT) {
  const target: ProjectSpace = { ...space, rootPath };
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
    resolveSpace: async () => target,
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
  const put = (content: string, pngBase64: string, error?: string) =>
    image.rpc.space_canvas_image_put(
      {
        projectId: space.projectId,
        path: PATH,
        sha256: sha(content),
        pngBase64,
        ...(error === undefined ? {} : { error }),
      },
    );
  const withdraw = () =>
    draw.rpc.space_draw_ack({ ids: pending().batches.map((batch) => batch.id) });
  const rows = () => (db.prepare(`SELECT COUNT(*) AS n FROM canvas_images`).get() as { n: number }).n;
  const drawTool = (spec: object) =>
    tools.get("space_draw")!.execute({ path: PATH, ...spec }, { projectId: space.projectId }) as Promise<ToolResult>;
  return { disk, view, pending, put, published, draw, written, withdraw, rows, drawTool };
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

  it("reports a file the renderer could not load instead of a blank picture", async () => {
    const { disk, view, put } = setup();
    disk.set(`${ROOT}/${PATH}`, '{"not": "a tldr');
    put('{"not": "a tldr', "", "it is not a readable tldraw document (notATldrawFile)");
    const result = await view();
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/cannot be pictured: it is not a readable tldraw document/);
  });

  it("asks again when its request is taken without a picture", async () => {
    const { disk, view, put, pending, withdraw } = setup();
    disk.set(`${ROOT}/${PATH}`, DOC);
    const result = view();
    await vi.waitFor(() => expect(pending().batches).toHaveLength(1));
    const first = pending().batches[0]!.id;
    withdraw(); // a renderer acked it, but its picture never arrived
    await vi.waitFor(() => expect(pending().batches.map((batch) => batch.id)).not.toContain(first));
    await vi.waitFor(() => expect(pending().batches).toHaveLength(1));
    put(DOC, "bmV3");
    expect((await result).content[1]).toMatchObject({ type: "image", data: "bmV3" });
    expect(pending().batches).toHaveLength(0);
  });

  it("forgets the picture of a canvas that is gone", async () => {
    const { view, put, rows } = setup();
    put(DOC, "iVBORw0KGgo=");
    expect(rows()).toBe(1);
    expect((await view()).content[0]!.text).toMatch(/does not exist/);
    expect(rows()).toBe(0);
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

  it("refuses a relative path that lands in the space", async () => {
    const { disk, put, draw, written } = setup();
    disk.set(`${ROOT}/${PATH}`, DOC);
    put(DOC, "iVBORw0KGgo=");
    const runIn = (cwd: string, png: string) =>
      draw.cli!.canvas!.run(
        { positionals: { path: PATH }, options: { png } } as never,
        { projectId: space.projectId, cwd } as never,
      );
    await expect(runIn(ROOT, "x.png")).rejects.toThrow(/not written into the space/);
    await expect(runIn(`${ROOT}/sub`, "../x.png")).rejects.toThrow(/not written into the space/);
    expect(written.size).toBe(0);
  });

  it("refuses a symlink into the space", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canvas-image-"));
    try {
      const root = join(dir, "repo", ".bb-space");
      mkdirSync(root, { recursive: true });
      symlinkSync(root, join(dir, "link"));
      const { disk, put, draw, written } = setup(root);
      disk.set(`${root}/${PATH}`, DOC);
      put(DOC, "iVBORw0KGgo=");
      await expect(run(draw, join(dir, "link", "x.png"))).rejects.toThrow(/not written into the space/);
      await expect(run(draw, join(dir, "out.png"))).resolves.toMatchObject({ exitCode: 0 });
      expect([...written.keys()]).toEqual([join(dir, "out.png")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to write into .bb-space", async () => {
    const { disk, put, draw, written } = setup();
    disk.set(`${ROOT}/${PATH}`, DOC);
    put(DOC, "iVBORw0KGgo=");
    await expect(run(draw, ".bb-space/canvas.png")).rejects.toThrow(/not written into the space/);
    expect(written.size).toBe(0);
  });
});

describe("space_draw on a canvas that cannot be loaded", () => {
  const spec = { clear: true, nodes: [{ id: "a", label: "A" }] };

  it("refuses a file that is not tldraw JSON, without queuing", async () => {
    const { disk, drawTool, pending } = setup();
    disk.set(`${ROOT}/${PATH}`, '{"not": "a tldr');
    const result = await drawTool(spec);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/was not drawn on: it is not a tldraw JSON document.*draw into a new path/);
    expect(pending().batches).toHaveLength(0);
    expect(disk.get(`${ROOT}/${PATH}`)).toBe('{"not": "a tldr');
  });

  it("stops waiting and withdraws the batch when a renderer cannot load it", async () => {
    const { disk, drawTool, pending, put } = setup();
    const content = '{"records":[]}';
    disk.set(`${ROOT}/${PATH}`, content);
    const result = drawTool(spec);
    await vi.waitFor(() => expect(pending().batches).toHaveLength(1));
    put(content, "", "it is not a readable tldraw document (notATldrawFile)");
    const settled = await result;
    expect(settled.isError).toBe(true);
    expect(settled.content[0]!.text).toMatch(/was not drawn on: it is not a readable tldraw document/);
    expect(pending().batches).toHaveLength(0);
  });
});
