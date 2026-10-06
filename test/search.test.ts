import { describe, expect, it } from "vitest";
import {
  isSearchablePath,
  looksBinary,
  matchCanvas,
  matchFile,
  matchText,
  snippetAround,
} from "../lib/search";
import { headingAtLine } from "../ui/outline";

const canvas = (...labels: string[]) =>
  JSON.stringify({
    records: [
      { typeName: "document", id: "document:document" },
      ...labels.map((label, index) => ({
        typeName: "shape",
        id: `shape:${index}`,
        type: "geo",
        props: {
          richText: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: label }] }],
          },
        },
      })),
    ],
  });

describe("matchText", () => {
  it("finds lines in any case, numbered from 1", () => {
    expect(matchText("# Title\nWe use TLDRAW here.\nnothing", "tldraw")).toEqual([
      { line: 2, snippet: "We use TLDRAW here." },
    ]);
  });

  it("stops at three hits per file", () => {
    const text = Array.from({ length: 10 }, (_, i) => `hit ${i}`).join("\n");
    expect(matchText(text, "hit").map((hit) => hit.line)).toEqual([1, 2, 3]);
  });

  it("matches nothing for an empty query", () => {
    expect(matchText("anything", "")).toEqual([]);
  });
});

describe("snippetAround", () => {
  it("keeps short lines whole", () => {
    expect(snippetAround("  a   short\tline ", 4, 5)).toBe("a short line");
  });

  it("cuts long lines around the hit with ellipses", () => {
    const line = `${"a".repeat(200)}NEEDLE${"b".repeat(200)}`;
    const snippet = snippetAround(line, 200, 6);
    expect(snippet).toContain("NEEDLE");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(122);
  });

  it("shows the end of a line when the hit is near it", () => {
    const line = `${"a".repeat(300)}END`;
    expect(snippetAround(line, 300, 3).endsWith("END")).toBe(true);
  });
});

describe("matchCanvas", () => {
  it("finds shape labels, without a line", () => {
    expect(matchCanvas(canvas("Server", "Off-screen tldraw"), "TLDRAW")).toEqual([
      { snippet: "Off-screen tldraw" },
    ]);
  });

  it("ignores files that are not canvases", () => {
    expect(matchCanvas("not json", "x")).toEqual([]);
  });

  it("is what matchFile uses for .tldr files", () => {
    expect(matchFile("a/diagram.tldr", canvas("records"), "records")).toEqual([{ snippet: "records" }]);
  });
});

describe("file selection", () => {
  it("reads text kinds and canvases, not images or PDFs", () => {
    expect(["a.md", "b.html", "c.txt", "d.tldr", "e.css"].every(isSearchablePath)).toBe(true);
    expect(["a.png", "b.pdf", "c.svg"].some(isSearchablePath)).toBe(false);
  });

  it("treats NUL bytes as binary", () => {
    expect(looksBinary("PK\u0003\u0004\u0000\u0000")).toBe(true);
    expect(looksBinary("plain text")).toBe(false);
  });
});

describe("headingAtLine", () => {
  const page = "# Title\n\nIntro\n\n## Goal\n\nFind a page.\n\n## Goal\n\nAgain.\n";

  it("gives the nearest heading at or above the line", () => {
    expect(headingAtLine(page, 1)).toBe("title");
    expect(headingAtLine(page, 3)).toBe("title");
    expect(headingAtLine(page, 7)).toBe("goal");
  });

  it("uses the slugger's ids for repeated headings", () => {
    expect(headingAtLine(page, 11)).toBe("goal-1");
  });

  it("is null above the first heading", () => {
    expect(headingAtLine("text\n\n# Later\n", 1)).toBeNull();
  });
});
