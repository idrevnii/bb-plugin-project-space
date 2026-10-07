// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { locateQuote, quoteSelector } from "../lib/annotations";
import { offsetOf, rangeOf, textModel, unwrapMarks, wrapMarks } from "../ui/annotate/text";

function article(html: string): HTMLElement {
  const root = document.createElement("article");
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}

describe("textModel", () => {
  it("joins text nodes like textContent, skipping data-annotate-skip", () => {
    const root = article(
      "<h1>Title</h1><div data-annotate-skip><p>orphans</p></div><p>The <em>quick</em> fox</p>",
    );
    const model = textModel(root);
    expect(model.text).toBe("TitleThe quick fox");
    expect(model.nodes.map((entry) => entry.start)).toEqual([0, 5, 9, 14]);
  });
});

describe("offsetOf and rangeOf", () => {
  const html = "<h1>Title</h1><p>The <em>quick</em> brown fox</p>";

  it("maps a selection across elements to text offsets and back", () => {
    const root = article(html);
    const model = textModel(root);
    const em = root.querySelector("em")!.firstChild!;
    const tail = root.querySelector("p")!.lastChild!;
    const start = offsetOf(model, em, 1);
    const end = offsetOf(model, tail, 6);
    expect(model.text.slice(start, end)).toBe("uick brown");
    expect(rangeOf(model, { start, end })!.toString()).toBe("uick brown");
  });

  it("maps element boundary points to the next text", () => {
    const root = article(html);
    const model = textModel(root);
    const paragraph = root.querySelector("p")!;
    expect(offsetOf(model, paragraph, 0)).toBe(5);
    expect(offsetOf(model, root, root.childNodes.length)).toBe(model.text.length);
  });

  it("finds a quote again after the page changes around it", () => {
    const before = textModel(article(html));
    const at = before.text.indexOf("brown");
    const selector = quoteSelector(before.text, at, at + "brown fox".length);
    const after = textModel(article("<h1>Title</h1><p>New intro.</p><p>A <em>quick</em> brown fox ran</p>"));
    const found = locateQuote(after.text, selector)!;
    expect(rangeOf(after, found)!.toString()).toBe("brown fox");
  });
});

describe("<mark> fallback", () => {
  it("wraps ranges, also across elements, and unwraps to the same DOM text", () => {
    const root = article("<p>The <em>quick</em> brown fox</p>");
    const model = textModel(root);
    wrapMarks(model, [
      { id: "a", range: { start: 5, end: 12 }, className: "space-annotation" },
      { id: "b", range: { start: 0, end: 3 }, className: "space-annotation" },
    ]);
    const marks = Array.from(root.querySelectorAll("mark")).map((mark) => [mark.dataset.annotationMark, mark.textContent]);
    expect(marks).toEqual([
      ["b", "The"],
      ["a", "uick"],
      ["a", " br"],
    ]);
    expect(textModel(root).text).toBe(model.text);
    unwrapMarks(root);
    expect(root.innerHTML).toBe("<p>The <em>quick</em> brown fox</p>");
  });
});
