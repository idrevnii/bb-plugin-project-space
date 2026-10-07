import { describe, expect, it } from "vitest";
import type { Anchor, Annotation } from "../lib/annotations";
import { REVIEW_HEADER, annotationIdsIn, reviewGroups, reviewMessage } from "../lib/review";

let clock = 0;
function annotation(
  id: string,
  path: string,
  comment: string,
  anchor: Anchor = { kind: "file" },
  status: Annotation["status"] = "open",
): Annotation {
  clock += 1;
  return { id, path, anchor, comment, status, author: "user", createdAt: clock, updatedAt: clock };
}

const quote = (exact: string): Anchor => ({ kind: "text-quote", exact, prefix: "", suffix: "" });

describe("reviewMessage", () => {
  it("numbers one line per annotation, ending with its id", () => {
    const message = reviewMessage([
      annotation("ann_aaaaaaaaaaaa", "architecture/index.md", "Say what a module is", quote("exact quote")),
      annotation("ann_bbbbbbbbbbbb", "architecture/index.md", "Too long"),
      annotation("ann_cccccccccccc", "guides/developing.md", "Add a diagram", { kind: "shapes", shapeIds: ["shape:a"] }),
    ]);
    expect(message).toBe(
      [
        "Review of the project space — 3 comments.",
        "1. architecture/index.md — «exact quote» → Say what a module is  [ann_aaaaaaaaaaaa]",
        "2. architecture/index.md → Too long  [ann_bbbbbbbbbbbb]",
        "3. guides/developing.md — shape shape:a → Add a diagram  [ann_cccccccccccc]",
        'Resolve each with `bb space annotations resolve <id> --note "…"` when done.',
      ].join("\n"),
    );
  });

  it("says 1 comment in the singular", () => {
    expect(reviewMessage([annotation("ann_one", "index.md", "Hi")]).split("\n")[0]).toBe(
      "Review of the project space — 1 comment.",
    );
  });

  it("collapses whitespace in quotes and clips long ones", () => {
    const long = `${"word ".repeat(60)}end`;
    const [, line] = reviewMessage([annotation("ann_q", "a.md", "c", quote(`two\n  lines ${long}`))]).split("\n");
    const quoted = line!.slice(line!.indexOf("«") + 1, line!.indexOf("»"));
    expect(quoted.startsWith("two lines word")).toBe(true);
    expect(quoted.length).toBeLessThanOrEqual(160);
    expect(quoted.endsWith("…")).toBe(true);
  });

  it("indents the further lines of a comment under its number", () => {
    const message = reviewMessage([annotation("ann_m", "a.md", "first\nsecond")]);
    expect(message.split("\n").slice(1, 3)).toEqual(["1. a.md → first", "   second  [ann_m]"]);
  });

  it("lists at most five shape ids", () => {
    const shapeIds = ["s:1", "s:2", "s:3", "s:4", "s:5", "s:6"];
    const [, line] = reviewMessage([annotation("ann_s", "c.tldr", "Align", { kind: "shapes", shapeIds })]).split("\n");
    expect(line).toBe("1. c.tldr — shapes s:1, s:2, s:3, s:4, s:5, … → Align  [ann_s]");
  });
});

describe("reviewGroups", () => {
  it("groups by file, open first inside a file and files with open comments first", () => {
    const resolvedOnly = annotation("ann_r", "a.md", "done", { kind: "file" }, "resolved");
    const sent = annotation("ann_s", "b.md", "sent", { kind: "file" }, "sent");
    const open = annotation("ann_o", "b.md", "open");
    const groups = reviewGroups([resolvedOnly, sent, open]);
    expect(groups.map((group) => [group.path, group.open, group.annotations.map((each) => each.id)])).toEqual([
      ["b.md", 1, ["ann_o", "ann_s"]],
      ["a.md", 0, ["ann_r"]],
    ]);
  });
});

describe("annotationIdsIn", () => {
  it("reads the ids back out of a message, once each", () => {
    const message = reviewMessage([
      annotation("ann_aaaaaaaaaaaa", "a.md", "x"),
      annotation("ann_bbbbbbbbbbbb", "b.md", "see [ann_aaaaaaaaaaaa]"),
    ]);
    expect(annotationIdsIn(message)).toEqual(["ann_aaaaaaaaaaaa", "ann_bbbbbbbbbbbb"]);
  });

  it("ignores ids outside a review message", () => {
    expect(annotationIdsIn("Look at [ann_aaaaaaaaaaaa]")).toEqual([]);
    expect(annotationIdsIn(`Before [ann_x] ${REVIEW_HEADER} — 1 comment. [ann_y]`)).toEqual(["ann_y"]);
  });
});
