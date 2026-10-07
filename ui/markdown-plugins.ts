// The reader's Markdown pipeline, beyond GFM: callouts (`> [!NOTE]`),
// `==highlights==`, and raw HTML such as <kbd>, <mark> and <details>,
// sanitized to GitHub's allowlist. Kept free of React so the round-trip test
// renders pages exactly as the reader does.
import type { Options } from "react-markdown";
import type { Blockquote, Nodes, Paragraph, PhrasingContent, Root, Text } from "mdast";
import { toString } from "mdast-util-to-string";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { defaultCalloutTitle, parseCalloutMarker } from "../lib/callouts";

type Schema = typeof defaultSchema;

const text = (value: string): Text => ({ type: "text", value });

/** The first line of a paragraph (up to its first newline) and the rest. */
function splitFirstLine(children: PhrasingContent[]): { line: PhrasingContent[]; rest: PhrasingContent[] } {
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    if (child.type === "break") return { line: children.slice(0, index), rest: children.slice(index + 1) };
    if (child.type === "text" && child.value.includes("\n")) {
      const at = child.value.indexOf("\n");
      const head = child.value.slice(0, at);
      const tail = child.value.slice(at + 1);
      return {
        line: [...children.slice(0, index), ...(head ? [text(head)] : [])],
        rest: [...(tail ? [text(tail)] : []), ...children.slice(index + 1)],
      };
    }
  }
  return { line: children, rest: [] };
}

function toCallout(node: Blockquote): void {
  const first = node.children[0];
  if (first?.type !== "paragraph" || first.children[0]?.type !== "text") return;
  const { line, rest } = splitFirstLine(first.children);
  const marker = parseCalloutMarker(toString({ type: "paragraph", children: line }));
  if (marker === null) return;

  // Drop the `[!type]±` prefix and keep the title's own formatting.
  const lead = line[0] as Text;
  const title = [text(lead.value.replace(/^\[![^\]]*\][+-]?[ \t]*/, "")), ...line.slice(1)].filter(
    (child) => child.type !== "text" || child.value !== "",
  );
  const folds = marker.fold !== "";
  const titleNode: Paragraph = {
    type: "paragraph",
    children: title.length > 0 ? title : [text(defaultCalloutTitle(marker.type))],
    data: { hName: folds ? "summary" : "p", hProperties: { dataCalloutTitle: "" } },
  };
  const body: Blockquote["children"] = [
    ...(rest.length > 0 ? [{ ...first, children: rest }] : []),
    ...node.children.slice(1),
  ];
  node.children = [titleNode, ...body];
  node.data = {
    hName: folds ? "details" : "blockquote",
    hProperties: {
      dataCallout: marker.kind,
      dataCalloutType: marker.type.toLowerCase(),
      ...(marker.fold === "+" ? { open: true } : {}),
    },
  };
}

/** Blockquotes that open with a `[!type]` line become callouts. */
export function remarkCallouts() {
  return (tree: Root) => {
    const walk = (node: Nodes) => {
      if (node.type === "blockquote") toCallout(node);
      if ("children" in node) for (const child of node.children) walk(child);
    };
    walk(tree);
  };
}

const OPEN = /==(?=[^\s=])/;

/** Index of a closing `==` right after non-space text, or -1. */
function closeIndex(value: string, from: number, afterElement: boolean): number {
  for (let index = value.indexOf("==", from); index !== -1; index = value.indexOf("==", index + 1)) {
    const before = index > 0 ? value[index - 1]! : null;
    if (before === null ? afterElement : !/[\s=]/.test(before)) return index;
  }
  return -1;
}

/**
 * Wraps `==text==` runs in mark nodes. A run may span emphasis, code or links
 * as long as both `==` sit in the same paragraph (or cell, or heading).
 */
function wrapHighlights(nodes: PhrasingContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  const queue = [...nodes];
  while (queue.length > 0) {
    const node = queue.shift()!;
    const open = node.type === "text" ? OPEN.exec(node.value) : null;
    if (node.type !== "text" || open === null) {
      out.push(node);
      continue;
    }
    const before = node.value.slice(0, open.index);
    const after = node.value.slice(open.index + 2);
    const inner: PhrasingContent[] = [];
    let closed: { rest: string; consumed: number } | null = null;
    const sameNode = closeIndex(after, 1, false);
    if (sameNode !== -1) {
      inner.push(text(after.slice(0, sameNode)));
      closed = { rest: after.slice(sameNode + 2), consumed: 0 };
    } else {
      if (after) inner.push(text(after));
      for (let index = 0; index < queue.length && closed === null; index++) {
        const next = queue[index]!;
        const at = next.type === "text" ? closeIndex(next.value, 0, true) : -1;
        if (next.type === "text" && at !== -1) {
          if (at > 0) inner.push(text(next.value.slice(0, at)));
          closed = { rest: next.value.slice(at + 2), consumed: index + 1 };
        } else {
          inner.push(next);
        }
      }
    }
    if (closed === null) {
      // No closer: the `==` is literal; keep scanning after it.
      out.push(text(before + "=="));
      if (after) queue.unshift(text(after));
      continue;
    }
    if (before) out.push(text(before));
    out.push({ type: "mark", data: { hName: "mark" }, children: inner } as unknown as PhrasingContent);
    queue.splice(0, closed.consumed);
    if (closed.rest) queue.unshift(text(closed.rest));
  }
  return out;
}

/** `==text==` as <mark>, the Obsidian highlight. */
export function remarkHighlight() {
  return (tree: Root) => {
    const walk = (node: Nodes) => {
      if (!("children" in node)) return;
      for (const child of node.children) walk(child as Nodes);
      if (
        node.type === "paragraph" ||
        node.type === "heading" ||
        node.type === "tableCell" ||
        node.type === "emphasis" ||
        node.type === "strong" ||
        node.type === "delete" ||
        node.type === "link"
      ) {
        node.children = wrapHighlights(node.children);
      }
    };
    walk(tree);
  };
}

/**
 * GitHub's allowlist plus <mark> and the callout attributes. Ids keep
 * GitHub's `user-content-` prefix; remark-rehype adds none of its own, so
 * footnote links say `#fn-1` and point at `user-content-fn-1`.
 */
export const sanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
  attributes: {
    ...defaultSchema.attributes,
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), "dataCallout", "dataCalloutType"],
    details: [...(defaultSchema.attributes?.details ?? []), "dataCallout", "dataCalloutType"],
    p: [...(defaultSchema.attributes?.p ?? []), "dataCalloutTitle"],
    summary: [...(defaultSchema.attributes?.summary ?? []), "dataCalloutTitle"],
  },
};

/** The id an in-page `#hash` link points at, after sanitizing. */
export function sanitizedId(id: string): string {
  return `${sanitizeSchema.clobberPrefix ?? ""}${id}`;
}

export const readerMarkdownOptions = {
  remarkPlugins: [remarkGfm, remarkCallouts, remarkHighlight],
  rehypePlugins: [rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeSlug],
  remarkRehypeOptions: { clobberPrefix: "" },
} satisfies Pick<Options, "remarkPlugins" | "rehypePlugins" | "remarkRehypeOptions">;
