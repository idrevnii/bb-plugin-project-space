import { describe, expect, it } from "vitest";
import { canvasColors, drawSpecSchema } from "../lib/canvas/spec";

const node = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, ...extra });

describe("drawSpecSchema", () => {
  it("accepts a minimal and a full spec", () => {
    expect(drawSpecSchema.safeParse({}).success).toBe(true);
    const full = {
      clear: true,
      layout: "tb",
      nodes: [node("a", { x: 0, y: 0, w: 200, h: 80, shape: "diamond", color: "light-blue" })],
      edges: [{ id: "e", from: "a", to: "a", label: "self", color: "red", dashed: true }],
      texts: [{ id: "t", text: "Title", size: "xl" }],
    };
    expect(drawSpecSchema.parse(full)).toEqual(full);
  });

  it("accepts every listed color", () => {
    for (const color of canvasColors) {
      expect(drawSpecSchema.safeParse({ nodes: [node("a", { color })] }).success).toBe(true);
    }
  });

  it("rejects colors tldraw does not have", () => {
    for (const color of ["purple", "#ff0000", "Blue", "white", ""]) {
      expect(drawSpecSchema.safeParse({ nodes: [node("a", { color })] }).success).toBe(false);
      expect(
        drawSpecSchema.safeParse({ edges: [{ from: "a", to: "b", color }] }).success,
      ).toBe(false);
    }
  });

  it("caps the number of nodes, edges and texts", () => {
    const nodes = (n: number) => Array.from({ length: n }, (_, i) => node(`n${i}`));
    expect(drawSpecSchema.safeParse({ nodes: nodes(120) }).success).toBe(true);
    expect(drawSpecSchema.safeParse({ nodes: nodes(121) }).success).toBe(false);
    const edges = Array.from({ length: 201 }, () => ({ from: "a", to: "b" }));
    expect(drawSpecSchema.safeParse({ edges }).success).toBe(false);
    const texts = Array.from({ length: 61 }, (_, i) => ({ id: `t${i}`, text: "x" }));
    expect(drawSpecSchema.safeParse({ texts }).success).toBe(false);
  });

  it("rejects bad shapes, layouts, sizes and ids", () => {
    const bad = [
      { nodes: [node("a", { shape: "hexagon" })] },
      { layout: "radial" },
      { nodes: [node("a", { w: 0 })] },
      { nodes: [node("a", { h: 2001 })] },
      { nodes: [node("")] },
      { nodes: [node("x".repeat(65))] },
      { nodes: [{ id: "a", label: "x".repeat(301) }] },
      { nodes: [{ id: "a" }] },
      { edges: [{ from: "", to: "b" }] },
      { texts: [{ id: "t", text: "x", size: "xxl" }] },
    ];
    for (const spec of bad) {
      expect(drawSpecSchema.safeParse(spec).success, JSON.stringify(spec)).toBe(false);
    }
  });
});
