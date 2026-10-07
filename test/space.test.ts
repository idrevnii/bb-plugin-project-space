import { describe, expect, it } from "vitest";
import {
  baseName,
  displayName,
  encodeSpacePath,
  extensionOf,
  fileKind,
  isBinaryKind,
  joinSpacePath,
  normalizeSpacePath,
  parentOf,
  resolveSpaceLink,
} from "../lib/space";

describe("normalizeSpacePath", () => {
  it("drops empty segments", () => {
    expect(normalizeSpacePath("/guides//for-agents.md/")).toBe("guides/for-agents.md");
    expect(normalizeSpacePath("")).toBe("");
    expect(normalizeSpacePath("/")).toBe("");
    expect(normalizeSpacePath("///")).toBe("");
  });

  it("keeps ordinary names, including dots and spaces inside a segment", () => {
    expect(normalizeSpacePath("a/b.c/d e.md")).toBe("a/b.c/d e.md");
    expect(normalizeSpacePath(".space/annotations.json")).toBe(".space/annotations.json");
    expect(normalizeSpacePath("a/..b/c...md")).toBe("a/..b/c...md");
  });

  it("rejects traversal, backslashes and NUL", () => {
    expect(normalizeSpacePath("../secret.md")).toBeNull();
    expect(normalizeSpacePath("a/../../b.md")).toBeNull();
    expect(normalizeSpacePath("a/..")).toBeNull();
    expect(normalizeSpacePath("..")).toBeNull();
    expect(normalizeSpacePath("a/./b.md")).toBeNull();
    expect(normalizeSpacePath(".")).toBeNull();
    expect(normalizeSpacePath("a\\b.md")).toBeNull();
    expect(normalizeSpacePath("..\\..\\etc\\passwd")).toBeNull();
    expect(normalizeSpacePath("a\0b.md")).toBeNull();
  });

  it("does not decode escapes, so %2e%2e stays a literal name", () => {
    expect(normalizeSpacePath("%2e%2e/x.md")).toBe("%2e%2e/x.md");
  });

  it("treats absolute input as space-relative", () => {
    expect(normalizeSpacePath("/etc/passwd")).toBe("etc/passwd");
  });
});

describe("resolveSpaceLink", () => {
  it("resolves relative links against the document's folder", () => {
    expect(resolveSpaceLink("guides/a.md", "b.md")).toEqual({ path: "guides/b.md", hash: "" });
    expect(resolveSpaceLink("guides/a.md", "./b.md")).toEqual({ path: "guides/b.md", hash: "" });
    expect(resolveSpaceLink("guides/a.md", "../index.md")).toEqual({ path: "index.md", hash: "" });
    expect(resolveSpaceLink("index.md", "img/a.png")).toEqual({ path: "img/a.png", hash: "" });
    expect(resolveSpaceLink("a/b/c.md", ".//d/./e.md")).toEqual({ path: "a/b/d/e.md", hash: "" });
  });

  it("treats a leading slash as the space root", () => {
    expect(resolveSpaceLink("deep/down/page.md", "/architecture/index.md")).toEqual({
      path: "architecture/index.md",
      hash: "",
    });
  });

  it("returns null for links that climb out of the space", () => {
    expect(resolveSpaceLink("index.md", "../outside.md")).toBeNull();
    expect(resolveSpaceLink("a/b.md", "../../x.md")).toBeNull();
    expect(resolveSpaceLink("a/b.md", "/../x.md")).toBeNull();
    expect(resolveSpaceLink("a/b.md", "%2e%2e/%2e%2e/x.md")).toBeNull();
    expect(resolveSpaceLink("a/b.md", "..%2F..%2Fx.md")).toBeNull();
  });

  it("returns null for URLs, protocol-relative links and bare anchors", () => {
    expect(resolveSpaceLink("a.md", "https://example.com/x.md")).toBeNull();
    expect(resolveSpaceLink("a.md", "HTTP://example.com")).toBeNull();
    expect(resolveSpaceLink("a.md", "mailto:me@example.com")).toBeNull();
    expect(resolveSpaceLink("a.md", "javascript:alert(1)")).toBeNull();
    expect(resolveSpaceLink("a.md", "//example.com/x")).toBeNull();
    expect(resolveSpaceLink("a.md", "#section")).toBeNull();
    expect(resolveSpaceLink("a.md", "")).toBeNull();
  });

  it("splits off the anchor and drops the query", () => {
    expect(resolveSpaceLink("a/b.md", "c.md#part-2")).toEqual({ path: "a/c.md", hash: "part-2" });
    expect(resolveSpaceLink("a/b.md", "c.md?raw=1#h")).toEqual({ path: "a/c.md", hash: "h" });
    expect(resolveSpaceLink("a/b.md", "c.md?x#")).toEqual({ path: "a/c.md", hash: "" });
  });

  it("decodes percent-encoded names", () => {
    expect(resolveSpaceLink("index.md", "my%20notes.md")).toEqual({ path: "my notes.md", hash: "" });
    expect(resolveSpaceLink("index.md", "caf%C3%A9.md")).toEqual({ path: "café.md", hash: "" });
  });

  it("returns null for malformed escapes", () => {
    expect(resolveSpaceLink("index.md", "bad%zz.md")).toBeNull();
    expect(resolveSpaceLink("index.md", "%E0%A4%A.md")).toBeNull();
  });

  it("resolves a folder link to the folder path", () => {
    expect(resolveSpaceLink("a/b.md", "./")).toEqual({ path: "a", hash: "" });
    expect(resolveSpaceLink("a/b.md", "..")).toEqual({ path: "", hash: "" });
  });
});

describe("fileKind", () => {
  it.each([
    ["index.md", "markdown"],
    ["README.MARKDOWN", "markdown"],
    ["post.mdx", "markdown"],
    ["report.html", "html"],
    ["old.HTM", "html"],
    ["diagram.tldr", "tldraw"],
    ["a/b/shot.PNG", "image"],
    ["photo.jpeg", "image"],
    ["photo.jpg", "image"],
    ["anim.gif", "image"],
    ["x.webp", "image"],
    ["x.avif", "image"],
    ["icon.svg", "image"],
    ["paper.pdf", "pdf"],
    ["notes.txt", "text"],
    ["data.json", "text"],
    ["Makefile", "text"],
    [".gitignore", "text"],
    ["dir.md/file", "text"],
  ] as const)("%s is %s", (path, kind) => {
    expect(fileKind(path)).toBe(kind);
  });

  it("marks images and PDFs as binary", () => {
    expect(isBinaryKind("image")).toBe(true);
    expect(isBinaryKind("pdf")).toBe(true);
    expect(isBinaryKind("markdown")).toBe(false);
    expect(isBinaryKind("tldraw")).toBe(false);
    expect(isBinaryKind("text")).toBe(false);
  });

  it("reads the extension of the last segment only", () => {
    expect(extensionOf("a.d/b")).toBe("");
    expect(extensionOf("a/b.tar.gz")).toBe("gz");
    expect(extensionOf(".env")).toBe("");
  });
});

describe("displayName", () => {
  it("strips the folder and the extension", () => {
    expect(displayName("guides/for-agents.md")).toBe("for-agents");
    expect(displayName("index.md")).toBe("index");
    expect(displayName("a/archive.tar.gz")).toBe("archive.tar");
  });

  it("keeps dotfiles and extensionless names whole", () => {
    expect(displayName(".gitignore")).toBe(".gitignore");
    expect(displayName("dir/Makefile")).toBe("Makefile");
    expect(displayName("")).toBe("");
  });
});

describe("path helpers", () => {
  it("joins, splits and encodes", () => {
    expect(joinSpacePath("", "a", "", "b.md")).toBe("a/b.md");
    expect(joinSpacePath()).toBe("");
    expect(parentOf("a/b/c.md")).toBe("a/b");
    expect(parentOf("c.md")).toBe("");
    expect(baseName("a/b/c.md")).toBe("c.md");
    expect(baseName("c.md")).toBe("c.md");
    expect(encodeSpacePath("my docs/a b#1?.md")).toBe("my%20docs/a%20b%231%3F.md");
  });
});
