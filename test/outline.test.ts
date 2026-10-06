import { describe, expect, it } from "vitest";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { outlineOf } from "../ui/outline";

/** Heading ids as MarkdownView's pipeline renders them. */
function renderedIds(markdown: string): string[] {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeSlug);
  const tree = processor.runSync(processor.parse(markdown));
  const ids: string[] = [];
  const visit = (node: { type: string; tagName?: string; properties?: { id?: unknown }; children?: unknown[] }) => {
    if (node.type === "element" && /^h[1-6]$/.test(node.tagName ?? "") && typeof node.properties?.id === "string") {
      ids.push(node.properties.id);
    }
    for (const child of node.children ?? []) visit(child as Parameters<typeof visit>[0]);
  };
  visit(tree as Parameters<typeof visit>[0]);
  return ids;
}

const SAMPLE = `# Roadmap

## Done — MVP (0.1)

### \`code\` and **bold** [link](x.md)

## Done — MVP (0.1)

Setext heading
--------------

> ## Quoted heading

- ## In a list

## Image ![alt text](a.png) <b>html</b>

\`\`\`md
# not a heading
\`\`\`

## Ünïcödé & symbols?!
`;

describe("outlineOf", () => {
  it("gives the ids rehype-slug renders, in order", () => {
    const outline = outlineOf(SAMPLE);
    expect(outline.map((heading) => heading.id)).toEqual(renderedIds(SAMPLE));
  });

  it("keeps levels and plain text", () => {
    expect(outlineOf(SAMPLE).slice(0, 5)).toEqual([
      { id: "roadmap", text: "Roadmap", level: 1 },
      { id: "done--mvp-01", text: "Done — MVP (0.1)", level: 2 },
      { id: "code-and-bold-link", text: "code and bold link", level: 3 },
      { id: "done--mvp-01-1", text: "Done — MVP (0.1)", level: 2 },
      { id: "setext-heading", text: "Setext heading", level: 2 },
    ]);
  });

  it("finds nothing in a page without headings", () => {
    expect(outlineOf("Just text.\n\n```\n# code\n```\n")).toEqual([]);
  });
});
