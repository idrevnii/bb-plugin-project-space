import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lintTldr, shapeBounds } from "../lib/canvas/lint";
import { describeTldr } from "../lib/canvas/read";

type Rec = Record<string, unknown>;

function geo(id: string, x: number, y: number, w: number, h: number, extra: Rec = {}): Rec {
  return {
    typeName: "shape",
    id: `shape:node-${id}`,
    type: "geo",
    parentId: "page:page",
    x,
    y,
    rotation: 0,
    props: { geo: "rectangle", w, h, growY: 0, scale: 1, ...extra },
  };
}

function tldr(...records: Rec[]): string {
  return JSON.stringify({ records });
}

describe("lintTldr", () => {
  it("reports two overlapping boxes", () => {
    const issues = lintTldr(tldr(geo("a", 0, 0, 200, 100), geo("b", 150, 60, 200, 100)));
    expect(issues).toEqual([{ kind: "overlap", a: '"a"', b: '"b"', w: 50, h: 40 }]);
  });

  it("does not report touching boxes", () => {
    expect(lintTldr(tldr(geo("a", 0, 0, 200, 100), geo("b", 200, 0, 200, 100)))).toEqual([]);
    // A couple of pixels is still touching.
    expect(lintTldr(tldr(geo("a", 0, 0, 200, 100), geo("b", 197, 0, 200, 100)))).toEqual([]);
  });

  it("ignores arrows", () => {
    const arrow = { typeName: "shape", id: "shape:edge-a->b", type: "arrow", x: 0, y: 0, props: {} };
    expect(lintTldr(tldr(geo("a", 0, 0, 200, 100), arrow))).toEqual([]);
  });

  it("counts growY in a box's height and reports a clear overflow", () => {
    const issues = lintTldr(
      tldr(geo("a", 0, 0, 200, 80, { growY: 60 }), geo("b", 0, 130, 200, 80)),
    );
    expect(issues).toContainEqual({ kind: "overlap", a: '"a"', b: '"b"', w: 200, h: 10 });
    expect(issues).toContainEqual({ kind: "overflow", shape: '"a"', by: 60, w: 200, h: 80 });
  });

  it("sizes notes, text, and children of groups", () => {
    const records: Rec[] = [
      { typeName: "shape", id: "shape:note1", type: "note", parentId: "page:page", x: 0, y: 0, props: { scale: 1, growY: 0 } },
      { typeName: "shape", id: "shape:group", type: "group", parentId: "page:page", x: 1000, y: 0, props: {} },
      { ...geo("child", 10, 20, 100, 50), parentId: "shape:group" },
      { typeName: "shape", id: "shape:text-t", type: "text", parentId: "page:page", x: 0, y: 500, props: { size: "m", autoSize: true, w: 8, richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] } } },
    ];
    const bounds = shapeBounds(records);
    expect(bounds.get("shape:note1")).toEqual({ x: 0, y: 0, w: 200, h: 200 });
    expect(bounds.get("shape:node-child")).toEqual({ x: 1010, y: 20, w: 100, h: 50 });
    expect(bounds.get("shape:text-t")!.w).toBeGreaterThan(50);
    expect(bounds.has("shape:group")).toBe(false);
  });

  it("finds nothing wrong with the architecture diagram", () => {
    const json = readFileSync(new URL("../.bb-space/architecture/diagram.tldr", import.meta.url), "utf8");
    expect(lintTldr(json)).toEqual([]);
    expect(describeTldr(json, "diagram.tldr")).toContain("Overlaps: none.");
  });
});

describe("describeTldr", () => {
  it("ends with an Overlaps section listing the pairs", () => {
    const text = describeTldr(tldr(geo("a", 0, 0, 200, 100), geo("b", 150, 60, 200, 100)), "x.tldr");
    expect(text.split("\n").slice(-2)).toEqual(["Overlaps:", '- "a" and "b" overlap by 50x40 px']);
  });
});
