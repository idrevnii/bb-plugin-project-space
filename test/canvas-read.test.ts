import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeTldr, drawnNodeIds, plainText, tldrRecords } from "../lib/canvas/read";

const fixture = readFileSync(new URL("./fixtures/diagram.tldr", import.meta.url), "utf8");

const rich = (...paragraphs: string[]) => ({
  type: "doc",
  content: paragraphs.map((text) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  })),
});

function file(records: unknown[]): string {
  return JSON.stringify({ tldrawFileFormatVersion: 1, records });
}

describe("describeTldr on the architecture diagram", () => {
  const text = describeTldr(fixture, "diagram.tldr");

  it("counts shapes in the header", () => {
    expect(text.split("\n")[0]).toBe("diagram.tldr — 15 shape(s) on the board.");
  });

  it("describes nodes with id, kind, color, label, position and size", () => {
    expect(text).toContain(
      '- id "agent" [rectangle, violet] "Agent thread" at (560, 0) 300x80',
    );
    // Multi-paragraph labels join with " / ".
    expect(text).toContain(
      '- id "server" [rectangle, blue] "server.ts / RPC · draw queue · fs.watch" at (280, 600) 300x110',
    );
  });

  it("describes arrows by the spec ids they bind", () => {
    expect(text).toContain('- agent -> server "space_draw"');
    expect(text).toContain('- files -> preview "HTML & images → iframe"');
    const arrows = text.split("Arrows:")[1].split("\n\n")[0].trim().split("\n");
    expect(arrows).toHaveLength(7);
  });

  it("describes free text", () => {
    expect(text).toContain('- id "title": "Project Space — how it fits together" at (0, -150)');
  });

  it("lists the drawn node ids", () => {
    expect([...drawnNodeIds(fixture)].sort()).toEqual(
      ["agent", "files", "headless", "page", "preview", "server", "user"],
    );
  });
});

describe("describeTldr edge cases", () => {
  it("reports an empty file as an empty canvas", () => {
    expect(describeTldr("", "a.tldr")).toBe("a.tldr — an empty canvas; nothing is drawn yet.");
    expect(describeTldr("  \n", "a.tldr")).toContain("empty canvas");
  });

  it("reports broken files instead of throwing", () => {
    for (const broken of ["{not json", "[]", "null", '{"records": 3}', '"str"']) {
      expect(describeTldr(broken, "a.tldr")).toBe("a.tldr — not a readable tldraw file.");
    }
    expect(tldrRecords("{")).toBeNull();
    expect(drawnNodeIds("{")).toEqual(new Set());
  });

  it("calls a file with no shapes blank, and skips junk records", () => {
    const text = describeTldr(file([null, 3, { typeName: "page", id: "page:1" }]), "a.tldr");
    expect(text).toContain("0 shape(s)");
    expect(text).toContain("The board is currently blank.");
  });

  it("describes user-drawn shapes, unbound arrows and other shape types", () => {
    const text = describeTldr(
      file([
        { typeName: "shape", id: "shape:abc", type: "geo", x: 1.4, y: 2.6, props: { geo: "ellipse", w: 10, h: 20 } },
        { typeName: "shape", id: "shape:n1", type: "note", x: 0, y: 0, props: { richText: rich("hello"), color: "yellow" } },
        { typeName: "shape", id: "shape:edge-x", type: "arrow", x: 5, y: 6, props: { text: "loose" } },
        { typeName: "shape", id: "shape:t1", type: "text", x: 0, y: 0, props: { richText: rich("caption") } },
        { typeName: "shape", id: "shape:d1", type: "draw", props: {} },
        { typeName: "shape", id: "shape:d2", type: "draw", props: {} },
        { typeName: "shape", id: "shape:f1", type: "frame", props: {} },
      ]),
      "a.tldr",
    );
    expect(text).toContain("- user-drawn (shape:abc) [ellipse] (no label) at (1, 3) 10x20");
    expect(text).toContain('- user-drawn (shape:n1) [note, yellow] "hello" at (0, 0)');
    expect(text).toContain('- unbound arrow at (5, 6) (id "x") "loose"');
    expect(text).toContain('- user-drawn: "caption" at (0, 0)');
    expect(text).toContain("Other shapes drawn by the user: 2 draw, 1 frame.");
  });

  it("names arrow ends by label for user shapes and ignores odd bindings", () => {
    const text = describeTldr(
      file([
        { typeName: "shape", id: "shape:a", type: "geo", props: { richText: rich("Alpha") } },
        { typeName: "shape", id: "shape:b", type: "geo", props: {} },
        { typeName: "shape", id: "shape:arr", type: "arrow", props: {} },
        { typeName: "binding", type: "arrow", fromId: "shape:arr", toId: "shape:a", props: { terminal: "start" } },
        { typeName: "binding", type: "arrow", fromId: "shape:arr", toId: "shape:b", props: { terminal: "end" } },
        { typeName: "binding", type: "arrow", fromId: "shape:arr", toId: "shape:x", props: { terminal: "middle" } },
        { typeName: "binding", type: "other", fromId: "shape:arr", toId: "shape:x", props: { terminal: "end" } },
      ]),
      "a.tldr",
    );
    expect(text).toContain("- Alpha -> shape:b");
  });
});

describe("plainText", () => {
  it("handles strings, rich text and junk", () => {
    expect(plainText("plain")).toBe("plain");
    expect(plainText(rich("a", "b"))).toBe("a / b");
    expect(
      plainText({ type: "paragraph", content: [{ text: "x" }, { text: "y" }, {}] }),
    ).toBe("xy");
    expect(plainText(null)).toBe("");
    expect(plainText(42)).toBe("");
    expect(plainText({ type: "doc" })).toBe("");
  });
});
