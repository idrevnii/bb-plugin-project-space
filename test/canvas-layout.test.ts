import { describe, expect, it } from "vitest";
import {
  estimateNodeSize,
  estimateTextSize,
  layoutSpec,
  type KnownNodes,
  type LayoutResult,
} from "../lib/canvas/layout";
import type { DrawSpec } from "../lib/canvas/spec";

const none: KnownNodes = new Map();
const node = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, ...extra });
const edge = (from: string, to: string, extra: Record<string, unknown> = {}) => ({ from, to, ...extra });

function pos(result: LayoutResult, id: string) {
  const placed = result.nodes.get(id);
  if (placed === undefined) throw new Error(`${id} was not placed`);
  return placed;
}

describe("estimateNodeSize", () => {
  it("keeps short labels at the minimum size", () => {
    expect(estimateNodeSize(node("a"))).toEqual({ w: 180, h: 70 });
  });

  it("widens first, then grows taller as the label gets longer", () => {
    const sizes = [10, 30, 60, 120, 240].map((n) =>
      estimateNodeSize({ id: "a", label: "word ".repeat(n / 5).trim() }),
    );
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i].w).toBeGreaterThanOrEqual(sizes[i - 1].w);
      expect(sizes[i].h).toBeGreaterThanOrEqual(sizes[i - 1].h);
    }
    expect(sizes[2].w).toBeGreaterThan(sizes[0].w);
    expect(sizes.at(-1)!.w).toBe(340);
    expect(sizes.at(-1)!.h).toBeGreaterThan(sizes[2].h);
  });

  it("counts explicit newlines as lines", () => {
    const one = estimateNodeSize({ id: "a", label: "a" });
    const four = estimateNodeSize({ id: "a", label: "a\nb\nc\nd" });
    expect(four.h).toBeGreaterThan(one.h);
  });

  it("wraps a word longer than a line onto as many lines as it needs", () => {
    // 23 characters fit a 340-wide line: 46 characters are exactly two lines.
    expect(estimateNodeSize({ id: "a", label: "x".repeat(46) })).toEqual({ w: 340, h: 84 });
    expect(estimateNodeSize({ id: "a", label: "x".repeat(47) })).toEqual({ w: 340, h: 114 });
    // After a short word the long one starts on a fresh line.
    expect(estimateNodeSize({ id: "a", label: `hi ${"x".repeat(46)}` })).toEqual({ w: 340, h: 114 });
  });

  it("gives ellipses and diamonds a line of slack", () => {
    const label = "two lines of label text here, at least";
    const rect = estimateNodeSize({ id: "a", label });
    expect(rect.h).toBe(84);
    expect(estimateNodeSize({ id: "a", label, shape: "ellipse" }).h).toBe(114);
    expect(estimateNodeSize({ id: "a", label, shape: "diamond" }).h).toBe(114);
  });

  it("lets explicit sizes win, one axis at a time", () => {
    expect(estimateNodeSize(node("a", { w: 50, h: 40 }))).toEqual({ w: 50, h: 40 });
    expect(estimateNodeSize(node("a", { w: 500 })).w).toBe(500);
    expect(estimateNodeSize(node("a", { h: 300 }))).toEqual({ w: 180, h: 300 });
  });

  it("keeps notes square-ish, growing only in height", () => {
    expect(estimateNodeSize(node("a", { shape: "note", w: 999 }))).toEqual({ w: 200, h: 200 });
    const long = estimateNodeSize({ id: "a", label: "word ".repeat(80), shape: "note" });
    expect(long.w).toBe(200);
    expect(long.h).toBeGreaterThan(200);
  });
});

describe("estimateTextSize", () => {
  it("scales with size, line count and line length", () => {
    const m = estimateTextSize({ text: "Title" });
    expect(estimateTextSize({ text: "Title", size: "xl" }).h).toBeGreaterThan(m.h);
    expect(estimateTextSize({ text: "Title\nSub" }).h).toBeGreaterThan(m.h);
    expect(estimateTextSize({ text: "A much longer title" }).w).toBeGreaterThan(m.w);
    expect(estimateTextSize({ text: "x".repeat(500) }).w).toBe(900);
  });
});

describe("layoutSpec", () => {
  const chain: DrawSpec = {
    nodes: [node("a"), node("b"), node("c")],
    edges: [edge("a", "b"), edge("b", "c")],
  };

  it("lays layers out left to right by default and in lr", () => {
    for (const layout of [undefined, "lr"] as const) {
      const result = layoutSpec({ ...chain, layout }, none);
      const [a, b, c] = ["a", "b", "c"].map((id) => pos(result, id));
      expect(a.x).toBeLessThan(b.x);
      expect(b.x).toBeLessThan(c.x);
      expect(new Set([a.y, b.y, c.y]).size).toBe(1);
      // Boxes do not touch along the flow.
      expect(b.x - a.x).toBeGreaterThan(result.sizes.get("a")!.w);
      expect(result.anchored).toBe(false);
    }
  });

  it("lays layers out top to bottom in tb", () => {
    const result = layoutSpec({ ...chain, layout: "tb" }, none);
    const [a, b, c] = ["a", "b", "c"].map((id) => pos(result, id));
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
    expect(new Set([a.x, b.x, c.x]).size).toBe(1);
    expect(b.y - a.y).toBeGreaterThan(result.sizes.get("a")!.h);
  });

  it("stacks a layer's nodes across the axis without overlap", () => {
    const spec: DrawSpec = {
      nodes: [node("root"), node("x"), node("y"), node("z")],
      edges: [edge("root", "x"), edge("root", "y"), edge("root", "z")],
    };
    const lr = layoutSpec(spec, none);
    const ys = ["x", "y", "z"].map((id) => pos(lr, id).y).sort((p, q) => p - q);
    expect(new Set(["x", "y", "z"].map((id) => pos(lr, id).x)).size).toBe(1);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(70);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(70);

    const tb = layoutSpec({ ...spec, layout: "tb" }, none);
    const xs = ["x", "y", "z"].map((id) => pos(tb, id).x).sort((p, q) => p - q);
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(180);
  });

  it("places a node one layer after its deepest predecessor", () => {
    const result = layoutSpec(
      { nodes: [node("a"), node("b"), node("c")], edges: [edge("a", "b"), edge("b", "c"), edge("a", "c")] },
      none,
    );
    expect(pos(result, "c").x).toBeGreaterThan(pos(result, "b").x);
  });

  it("makes room for labelled arrows between layers", () => {
    const plain = layoutSpec(chain, none);
    const labelled = layoutSpec(
      { ...chain, edges: [edge("a", "b", { label: "a fairly long arrow label" }), edge("b", "c")] },
      none,
    );
    const gap = (r: LayoutResult) => pos(r, "b").x - pos(r, "a").x;
    expect(gap(labelled)).toBeGreaterThan(gap(plain));
  });

  it("terminates on cycles and keeps the cycle's entry first", () => {
    const result = layoutSpec(
      {
        nodes: [node("client"), node("server"), node("db")],
        edges: [edge("client", "server"), edge("server", "db"), edge("db", "server"), edge("server", "client")],
      },
      none,
    );
    expect(pos(result, "client").x).toBeLessThan(pos(result, "server").x);
    expect(pos(result, "server").x).toBeLessThan(pos(result, "db").x);
  });

  it("terminates on a large dense cyclic graph", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `n${i}`);
    const edges = ids.flatMap((id, i) => [edge(id, ids[(i + 1) % ids.length]), edge(id, ids[(i * 7) % ids.length])]);
    const result = layoutSpec({ nodes: ids.map((id) => node(id)), edges }, none);
    expect(result.nodes.size).toBe(120);
  });

  it("ignores self-loops and edges to unknown nodes", () => {
    const result = layoutSpec(
      { nodes: [node("a"), node("b")], edges: [edge("a", "a"), edge("a", "ghost"), edge("a", "b")] },
      none,
    );
    expect(pos(result, "a").x).toBeLessThan(pos(result, "b").x);
  });

  it("puts unconnected nodes in a band below the flow", () => {
    const result = layoutSpec(
      { nodes: [node("a"), node("b"), node("note1"), node("note2")], edges: [edge("a", "b")] },
      none,
    );
    const flowBottom = pos(result, "a").y + result.sizes.get("a")!.h;
    expect(pos(result, "note1").y).toBeGreaterThan(flowBottom);
    expect(pos(result, "note2").y).toBe(pos(result, "note1").y);
  });

  it("wraps a spec of only unconnected nodes into a block", () => {
    const result = layoutSpec({ nodes: Array.from({ length: 9 }, (_, i) => node(`n${i}`)) }, none);
    const rows = new Set([...result.nodes.values()].map((p) => p.y));
    const cols = new Set([...result.nodes.values()].map((p) => p.x));
    expect(rows.size).toBe(3);
    expect(cols.size).toBe(3);
  });

  it("does no placement in none mode but still sizes nodes", () => {
    const result = layoutSpec({ ...chain, layout: "none" }, none);
    expect(result.nodes.size).toBe(0);
    expect(result.sizes.size).toBe(3);
  });

  it("anchors the layout on nodes with explicit coordinates", () => {
    const free = layoutSpec(chain, none);
    const result = layoutSpec(
      { ...chain, nodes: [node("a", { x: 1000, y: 500 }), node("b"), node("c")] },
      none,
    );
    expect(result.anchored).toBe(true);
    expect(result.nodes.has("a")).toBe(false);
    // The rest keeps its shape, translated so `a` stays where it is.
    const shift = { x: 1000 - pos(free, "a").x, y: 500 - pos(free, "a").y };
    expect(pos(result, "b")).toEqual({ x: pos(free, "b").x + shift.x, y: pos(free, "b").y + shift.y });
    expect(pos(result, "c")).toEqual({ x: pos(free, "c").x + shift.x, y: pos(free, "c").y + shift.y });
  });

  it("anchors on nodes already on the canvas, so re-sent ids do not jump", () => {
    const known: KnownNodes = new Map([["a", { x: -300, y: 40 }]]);
    const first = layoutSpec(chain, known);
    expect(first.anchored).toBe(true);
    expect(first.nodes.has("a")).toBe(false);
    expect(pos(first, "b").x).toBeGreaterThan(-300);
    // Sending the same diagram again with b now known leaves c where it was.
    const again = layoutSpec(chain, new Map([...known, ["b", pos(first, "b")]]));
    expect(pos(again, "c")).toEqual(pos(first, "c"));
  });

  it("re-lays out everything when lr or tb is forced", () => {
    const known: KnownNodes = new Map([["a", { x: -300, y: 40 }]]);
    const result = layoutSpec(
      { ...chain, layout: "tb", nodes: [node("a", { x: 1000, y: 500 }), node("b"), node("c")] },
      known,
    );
    expect(result.anchored).toBe(false);
    expect(result.nodes.size).toBe(3);
  });

  it("stacks unpositioned texts above the diagram in listed order", () => {
    const result = layoutSpec(
      { ...chain, texts: [{ id: "title", text: "Title" }, { id: "sub", text: "Subtitle" }, { id: "fixed", text: "x", x: 0, y: 0 }] },
      none,
    );
    const top = Math.min(...[...result.nodes.values()].map((p) => p.y));
    const title = result.texts.get("title")!;
    const sub = result.texts.get("sub")!;
    expect(sub.y).toBeLessThan(top);
    expect(title.y).toBeLessThan(sub.y);
    expect(title.x).toBe(pos(result, "a").x);
    expect(result.texts.has("fixed")).toBe(false);
  });

  it("puts texts above anchored nodes and skips texts already on the canvas", () => {
    const result = layoutSpec(
      {
        nodes: [node("a", { x: 400, y: 400 })],
        texts: [{ id: "title", text: "T" }, { id: "old", text: "kept" }],
      },
      new Map([["old", { x: 0, y: 0 }]]),
    );
    expect(result.texts.get("title")).toEqual({ x: 400, y: 310 });
    expect(result.texts.has("old")).toBe(false);
  });

  it("puts texts at the origin when there are no nodes", () => {
    const result = layoutSpec({ texts: [{ id: "t", text: "alone" }] }, none);
    expect(result.texts.get("t")).toEqual({ x: 0, y: -90 });
  });
});
