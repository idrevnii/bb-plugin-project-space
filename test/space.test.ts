import { describe, expect, it } from "vitest";
import { normalizeSpacePath } from "../lib/space";

describe("normalizeSpacePath", () => {
  it("drops empty segments", () => {
    expect(normalizeSpacePath("/guides//for-agents.md/")).toBe("guides/for-agents.md");
    expect(normalizeSpacePath("")).toBe("");
  });

  it("rejects traversal, backslashes and NUL", () => {
    expect(normalizeSpacePath("../secret.md")).toBeNull();
    expect(normalizeSpacePath("a/./b.md")).toBeNull();
    expect(normalizeSpacePath("a\\b.md")).toBeNull();
    expect(normalizeSpacePath("a\0b.md")).toBeNull();
  });
});
