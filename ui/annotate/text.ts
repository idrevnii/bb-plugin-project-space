// The rendered text of a page and the DOM ranges behind its offsets: what
// annotations on rendered documents anchor against. No React, so it is unit
// tested directly.
import type { TextRange } from "../../lib/annotations";

/** The article's text nodes in order, with their offsets in the joined text. */
export interface TextModel {
  text: string;
  nodes: { node: Text; start: number }[];
}

/** Like `textContent`, minus UI marked `data-annotate-skip`. */
export function textModel(root: HTMLElement): TextModel {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("[data-annotate-skip]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: TextModel["nodes"] = [];
  let text = "";
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push({ node: node as Text, start: text.length });
    text += (node as Text).data;
  }
  return { text, nodes };
}

/** Offset in the model's text of a DOM boundary point. */
export function offsetOf(model: TextModel, container: Node, offset: number): number {
  const own = model.nodes.find((entry) => entry.node === container);
  if (own !== undefined) return own.start + Math.min(offset, own.node.length);
  const point = document.createRange();
  point.setStart(container, offset);
  const next = model.nodes.find((entry) => point.comparePoint(entry.node, 0) >= 0);
  return next?.start ?? model.text.length;
}

/** A DOM range over `text[start, end)` of the model. */
export function rangeOf(model: TextModel, { start, end }: TextRange): Range | null {
  const from = model.nodes.find((entry) => entry.start + entry.node.length > start);
  const to = model.nodes.find((entry) => entry.start + entry.node.length >= end);
  if (from === undefined || to === undefined) return null;
  const range = document.createRange();
  range.setStart(from.node, start - from.start);
  range.setEnd(to.node, end - to.start);
  return range;
}

export function supportsHighlights(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function";
}

/** `CSS.highlights`; the DOM lib here types it without its Map methods. */
export const highlights = () => CSS.highlights as unknown as Map<string, Highlight>;

// <mark> fallback: wraps from the last segment back, so earlier offsets in a
// split text node stay valid.
export function wrapMarks(model: TextModel, ranges: { id: string; range: TextRange; className: string }[]) {
  const segments = ranges.flatMap(({ id, range, className }) =>
    model.nodes.flatMap((entry) => {
      const from = Math.max(range.start, entry.start) - entry.start;
      const to = Math.min(range.end, entry.start + entry.node.length) - entry.start;
      return to > from ? [{ id, className, entry, from, to }] : [];
    }),
  );
  segments.sort((a, b) => b.entry.start + b.from - (a.entry.start + a.from));
  for (const { id, className, entry, from, to } of segments) {
    if (from >= entry.node.length) continue;
    const target = from > 0 ? entry.node.splitText(from) : entry.node;
    if (to - from < target.length) target.splitText(to - from);
    const mark = document.createElement("mark");
    mark.dataset.annotationMark = id;
    mark.className = className;
    target.replaceWith(mark);
    mark.append(target);
  }
}

export function unwrapMarks(root: HTMLElement) {
  const parents = new Set<Node>();
  for (const mark of Array.from(root.querySelectorAll("mark[data-annotation-mark]"))) {
    if (mark.parentNode !== null) parents.add(mark.parentNode);
    mark.replaceWith(...Array.from(mark.childNodes));
  }
  for (const parent of parents) parent.normalize();
}
