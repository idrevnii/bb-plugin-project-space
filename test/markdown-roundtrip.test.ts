// @vitest-environment happy-dom
// Loading a space page into the WYSIWYG editor and saving it without edits
// must not change what the reader renders.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import {
  getEditorMarkdown,
  markdownExtensions,
  roundTripMarkdown,
  splitFrontmatter,
  withTrailingNewline,
} from "../ui/page/markdown-extensions";

const SPACE = join(import.meta.dirname, "..", ".bb-space");

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

/** What the reader shows, with whitespace-only differences folded away. */
function rendered(markdown: string): string {
  const html = renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown),
  );
  return html.replace(/\s+/g, " ").replace(/> </g, "><").trim();
}

const SAMPLES: Record<string, string> = {
  "list markers": "* star\n* list\n\n1. one\n2. two\n\n+ plus\n",
  "nested lists": "- a\n  - b\n    1. c\n- d\n",
  escapes: "Literal \\*stars\\*, \\_under\\_, 1\\. not a list, a \\| pipe, `code *x*`.\n",
  "task list": "- [ ] open\n- [x] done\n  - [ ] nested\n",
  table: "| a | b |\n|---|---|\n| `x` | **y** |\n| [l](t.md) | \\| |\n",
  "code fence": "```ts\nconst a = 1;\n```\n\n~~~\nplain\n~~~\n",
  image: "![alt](../img/a.png \"title\")\n",
  frontmatter: "---\ntitle: X\n---\n\n# Heading\n\nBody.\n",
  "html and breaks": "line one  \nline two\n\n<details><summary>s</summary>\n\nhidden\n\n</details>\n",
  "inline html": "Press <kbd>Ctrl</kbd>+<kbd>S</kbd>.<br>\n\n<!-- note -->\n",
  "soft break after a mark": "Text `code`\nnext, **bold**\nnext, [link](x)\nnext.\n",
  "code inside other marks": "[see `x` here](u) and *em `y` em*.\n",
  "tight list with a fence": "1. a:\n   ```\n   x\n   ```\n2. b\n",
};

describe("markdown round trip", () => {
  for (const file of markdownFiles(SPACE)) {
    it(relative(SPACE, file), () => {
      const content = readFileSync(file, "utf8");
      expect(rendered(roundTripMarkdown(content))).toBe(rendered(content));
    });
  }

  for (const [name, content] of Object.entries(SAMPLES)) {
    it(`sample: ${name}`, () => {
      expect(rendered(roundTripMarkdown(content))).toBe(rendered(content));
    });
  }

  it("keeps frontmatter verbatim", () => {
    const content = "---\ntitle: X\n---\n\nBody.\n";
    expect(splitFrontmatter(roundTripMarkdown(content)).frontmatter).toBe("---\ntitle: X\n---\n");
  });

  it("serializes table, task and link edits", () => {
    const content = "Link here.\n\n| a | b |\n| --- | --- |\n| x | cell |\n\n- [ ] todo\n- [ ] keep\n";
    const editor = new Editor({ extensions: markdownExtensions(), content });
    try {
      const find = (predicate: (node: PmNode) => boolean) => {
        let found = -1;
        editor.state.doc.descendants((node, pos) => {
          if (found === -1 && predicate(node)) found = pos;
          return found === -1;
        });
        return found;
      };
      const cell = find((node) => node.isText && node.text === "cell");
      editor.chain().insertContentAt(cell + "cell".length, "X").run();
      const task = find((node) => node.type.name === "taskItem");
      editor.chain().setNodeSelection(task).updateAttributes("taskItem", { checked: true }).run();
      editor.chain().setTextSelection({ from: 1, to: 5 }).setLink({ href: "other.md" }).run();
      expect(withTrailingNewline(getEditorMarkdown(editor))).toBe(
        "[Link](other.md) here.\n\n| a | b |\n| --- | --- |\n| x | cellX |\n\n- [x] todo\n- [ ] keep\n",
      );
    } finally {
      editor.destroy();
    }
  });

  it("is stable after one pass", () => {
    for (const content of Object.values(SAMPLES)) {
      const once = roundTripMarkdown(content);
      expect(roundTripMarkdown(once)).toBe(once);
    }
  });
});
