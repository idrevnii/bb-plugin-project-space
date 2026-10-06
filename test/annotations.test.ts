import { describe, expect, it } from "vitest";
import {
  annotationFilePath,
  isMetaPath,
  locateQuote,
  newAnnotationId,
  quoteSelector,
} from "../lib/annotations";

const DOC = `# Space

The space is a full screen, not a thread panel, so annotations need an
explicit route back to an agent. Comments gather in a Review tab.
`;

function select(text: string, quote: string) {
  const start = text.indexOf(quote);
  expect(start).toBeGreaterThanOrEqual(0);
  return quoteSelector(text, start, start + quote.length);
}

function found(text: string, range: { start: number; end: number } | null) {
  return range === null ? null : text.slice(range.start, range.end);
}

describe("quoteSelector", () => {
  it("keeps 32 characters of context on each side", () => {
    const selector = select(DOC, "explicit route");
    expect(selector.exact).toBe("explicit route");
    expect(selector.prefix).toHaveLength(32);
    expect(DOC.includes(selector.prefix + selector.exact + selector.suffix)).toBe(true);
    expect(selector.suffix).toHaveLength(32);
  });

  it("clamps at the ends of the text", () => {
    expect(quoteSelector("abcdef", 0, 2)).toEqual({ exact: "ab", prefix: "", suffix: "cdef" });
    expect(quoteSelector("abcdef", 4, 99)).toEqual({ exact: "ef", prefix: "abcd", suffix: "" });
  });
});

describe("locateQuote", () => {
  it("finds the quote in unchanged text", () => {
    const selector = select(DOC, "explicit route back");
    const range = locateQuote(DOC, selector);
    expect(range).toEqual({ start: DOC.indexOf("explicit"), end: DOC.indexOf("explicit") + 19 });
  });

  it("follows the quote when text is inserted before it", () => {
    const selector = select(DOC, "explicit route back");
    const edited = DOC.replace("# Space\n", "# Space\n\nA whole new paragraph goes here.\n");
    expect(found(edited, locateQuote(edited, selector))).toBe("explicit route back");
  });

  it("finds a slightly edited quote", () => {
    const selector = select(DOC, "annotations need an\nexplicit route back to an agent");
    const edited = DOC.replace("explicit route back", "explicit way back");
    expect(found(edited, locateQuote(edited, selector))).toBe(
      "annotations need an\nexplicit way back to an agent",
    );
  });

  it("returns null when the quote is gone", () => {
    const selector = select(DOC, "explicit route back to an agent");
    const edited = DOC.replace("explicit route back to an agent", "a button");
    expect(locateQuote(edited, selector)).toBeNull();
  });

  it("tells repeated quotes apart by their context", () => {
    const text = "Alpha says hello world.\nBeta says hello world.\nGamma says hello world.\n";
    const second = text.indexOf("hello world", text.indexOf("Beta"));
    const selector = quoteSelector(text, second, second + "hello world".length);
    expect(locateQuote(text, selector)).toEqual({ start: second, end: second + 11 });

    // Still the Beta one after the lines around it move.
    const edited = `Intro.\n${text.replace("Alpha", "Alpha, longer now,")}`;
    const range = locateQuote(edited, selector);
    expect(range?.start).toBe(edited.indexOf("hello world", edited.indexOf("Beta")));
  });

  it("tells repeated edited quotes apart by their context", () => {
    const text = "One: the quick brown fox.\nTwo: the quick brown fox.\n";
    const second = text.lastIndexOf("the quick brown fox");
    const selector = quoteSelector(text, second, second + 19);
    const edited = text.replaceAll("quick brown", "quick red");
    const range = locateQuote(edited, selector);
    expect(range?.start).toBe(edited.lastIndexOf("the quick red fox"));
  });

  it("matches short quotes only exactly", () => {
    const selector = select("a cat sat", "cat");
    expect(locateQuote("a cot sat", selector)).toBeNull();
    expect(locateQuote("", selector)).toBeNull();
  });
});

describe("helpers", () => {
  it("places annotation files under .space/annotations", () => {
    expect(annotationFilePath("guides/a.md")).toBe(".space/annotations/guides/a.md.json");
    expect(isMetaPath(".space/annotations/x.json")).toBe(true);
    expect(isMetaPath(".spacey/x.md")).toBe(false);
  });

  it("makes ann_ ids", () => {
    expect(newAnnotationId()).toMatch(/^ann_[0-9a-z]{12}$/);
    expect(newAnnotationId()).not.toBe(newAnnotationId());
  });
});
