import { describe, expect, it } from "vitest";
import { parseLineHash, resolveDocumentLink, resolveSpaceLink } from "../lib/space";

describe("resolveSpaceLink", () => {
  it("resolves relative and root-absolute links inside the space", () => {
    expect(resolveSpaceLink("guides/a.md", "./b.md")).toEqual({ path: "guides/b.md", hash: "" });
    expect(resolveSpaceLink("guides/a.md", "../index.md#start")).toEqual({ path: "index.md", hash: "start" });
    expect(resolveSpaceLink("guides/a.md", "/arch/index.md")).toEqual({ path: "arch/index.md", hash: "" });
    expect(resolveSpaceLink("a.md", "img/x%20y.png?v=2")).toEqual({ path: "img/x y.png", hash: "" });
  });

  it("gives up on URLs, anchors and links that leave the space", () => {
    expect(resolveSpaceLink("a.md", "https://example.com")).toBeNull();
    expect(resolveSpaceLink("a.md", "mailto:a@b.c")).toBeNull();
    expect(resolveSpaceLink("a.md", "//cdn.example.com/x.js")).toBeNull();
    expect(resolveSpaceLink("a.md", "#heading")).toBeNull();
    expect(resolveSpaceLink("a.md", "")).toBeNull();
    expect(resolveSpaceLink("guides/a.md", "../../server.ts")).toBeNull();
  });
});

describe("parseLineHash", () => {
  it("reads lines and ranges", () => {
    expect(parseLineHash("L40")).toEqual({ kind: "line", line: 40 });
    expect(parseLineHash("L40-L52")).toEqual({ kind: "range", startLine: 40, endLine: 52 });
    expect(parseLineHash("L40-52")).toEqual({ kind: "range", startLine: 40, endLine: 52 });
    expect(parseLineHash("L7-L7")).toEqual({ kind: "line", line: 7 });
  });

  it("ignores anything else", () => {
    expect(parseLineHash("")).toBeNull();
    expect(parseLineHash("intro")).toBeNull();
    expect(parseLineHash("L0")).toBeNull();
    expect(parseLineHash("L52-L40")).toBeNull();
  });
});

describe("resolveDocumentLink", () => {
  it("keeps space-internal links exactly as resolveSpaceLink has them", () => {
    for (const [from, href] of [
      ["guides/a.md", "./b.md"],
      ["guides/a.md", "../index.md#start"],
      ["guides/a.md", "/arch/index.md"],
      ["a.md", "img/x%20y.png?v=2"],
    ] as const) {
      expect(resolveDocumentLink(from, href)).toEqual({ kind: "space", ...resolveSpaceLink(from, href) });
    }
  });

  it("returns null for URLs and same-page anchors", () => {
    expect(resolveDocumentLink("a.md", "https://example.com")).toBeNull();
    expect(resolveDocumentLink("a.md", "#heading")).toBeNull();
    expect(resolveDocumentLink("a.md", "")).toBeNull();
  });

  it("resolves links that climb out of the space against the checkout", () => {
    expect(resolveDocumentLink("tasks/t16.md", "../../server/index.ts#L10")).toEqual({
      kind: "checkout",
      path: "server/index.ts",
      lines: { kind: "line", line: 10 },
    });
    expect(resolveDocumentLink("index.md", "../src/app.ts#L40-L52")).toEqual({
      kind: "checkout",
      path: "src/app.ts",
      lines: { kind: "range", startLine: 40, endLine: 52 },
    });
    expect(resolveDocumentLink("index.md", "../README.md#usage")).toEqual({
      kind: "checkout",
      path: "README.md",
      lines: null,
    });
  });

  it("treats a climb that comes back into the space as a space link", () => {
    expect(resolveDocumentLink("guides/a.md", "../../.bb-space/index.md#top")).toEqual({
      kind: "space",
      path: "index.md",
      hash: "top",
    });
  });

  it("refuses links that escape the checkout", () => {
    expect(resolveDocumentLink("index.md", "../../etc/passwd")).toEqual({
      kind: "outside",
      href: "../../etc/passwd",
    });
    expect(resolveDocumentLink("guides/a.md", "../../../other/x.ts")?.kind).toBe("outside");
  });

  it("sends root-absolute links to the checkout only when the space lacks the file", () => {
    const spaceHas = (path: string) => path === "arch/index.md";
    expect(resolveDocumentLink("a.md", "/arch/index.md", spaceHas)).toEqual({
      kind: "space",
      path: "arch/index.md",
      hash: "",
    });
    expect(resolveDocumentLink("a.md", "/src/app.ts#L40", spaceHas)).toEqual({
      kind: "checkout",
      path: "src/app.ts",
      lines: { kind: "line", line: 40 },
    });
    expect(resolveDocumentLink("a.md", "/.bb-space/arch/index.md", spaceHas)).toEqual({
      kind: "space",
      path: "arch/index.md",
      hash: "",
    });
    // Without a tree to check, root-absolute links stay in the space.
    expect(resolveDocumentLink("a.md", "/src/app.ts")?.kind).toBe("space");
  });
});
