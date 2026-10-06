import { describe, expect, it } from "vitest";
import { followMove, moveDestinations, planMove } from "../ui/tree-move";

const existing = new Set(["notes", "notes/a.md", "b.md", "guides", "guides/b.md"]);
const exists = (path: string) => existing.has(path);

describe("planMove", () => {
  it("moves into a folder and back to the root", () => {
    expect(planMove("b.md", "notes", exists)).toEqual({ kind: "move", from: "b.md", to: "notes/b.md" });
    expect(planMove("notes/a.md", "", exists)).toEqual({ kind: "move", from: "notes/a.md", to: "a.md" });
  });

  it("is a no-op within the same folder", () => {
    expect(planMove("notes/a.md", "notes", exists)).toEqual({ kind: "noop" });
  });

  it("refuses a folder into itself or a descendant", () => {
    expect(planMove("notes", "notes", exists).kind).toBe("refuse");
    expect(planMove("notes", "notes/sub", exists).kind).toBe("refuse");
    expect(planMove("notes", "notes-old", exists).kind).toBe("move");
  });

  it("refuses an existing name", () => {
    expect(planMove("b.md", "guides", exists)).toEqual({ kind: "refuse", reason: "guides/b.md already exists" });
  });
});

describe("followMove", () => {
  it("follows the file and anything inside a moved folder", () => {
    expect(followMove("b.md", "b.md", "notes/b.md")).toBe("notes/b.md");
    expect(followMove("notes/a.md", "notes", "guides/notes")).toBe("guides/notes/a.md");
    expect(followMove("notes-old/a.md", "notes", "guides/notes")).toBeNull();
  });
});

describe("moveDestinations", () => {
  it("lists the root and folders, minus the current parent and the subtree", () => {
    expect(moveDestinations("notes/a.md", ["guides", "notes"])).toEqual(["", "guides"]);
    expect(moveDestinations("notes", ["guides", "notes", "notes/sub"])).toEqual(["guides"]);
  });
});
