// TipTap schema for editing space Markdown in place. Kept free of React and
// the plugin SDK so the round-trip test can build the same editor headless.
import { Editor, Extension, Node, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Code from "@tiptap/extension-code";
import Text from "@tiptap/extension-text";
import Image from "@tiptap/extension-image";
import { ListItem, TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "tiptap-markdown";

export interface MarkdownExtensionOptions {
  /**
   * Maps an image `src` as written in the file to the URL the browser loads.
   * The document keeps the original `src`, so saving never writes preview URLs.
   */
  resolveImage?: (src: string) => string | undefined;
}

export function markdownExtensions({ resolveImage }: MarkdownExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: false, linkOnPaste: true },
      // No Markdown form; would serialize as raw HTML.
      underline: false,
      text: false,
      code: false,
      listItem: false,
    }),
    SpaceText,
    // Markdown allows `code` inside links and emphasis; TipTap's default
    // excludes every other mark. Registered after the others so it stays
    // innermost when serialized.
    Code.extend({ excludes: "" }),
    ListItem.extend({ addStorage: () => ({ markdown: { serialize: serializeListItem() } }) }),
    RawHtmlBlock,
    RawHtmlInline,
    SpaceMarkdownFixes,
    Image.extend({
      addNodeView() {
        return ({ node }) => {
          const img = document.createElement("img");
          const src = String(node.attrs.src ?? "");
          const resolved = resolveImage ? resolveImage(src) : src;
          if (resolved !== undefined) img.src = resolved;
          img.alt = String(node.attrs.alt ?? "");
          if (node.attrs.title) img.title = String(node.attrs.title);
          img.className = "space-image";
          img.draggable = false;
          return { dom: img };
        };
      },
    }).configure({ inline: true }),
    TaskList,
    TaskItem.extend({
      addStorage: () => ({
        markdown: { serialize: serializeListItem((node) => (node.attrs.checked ? "[x] " : "[ ] ")) },
      }),
    }).configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Markdown.configure({
      html: true,
      tightLists: true,
      bulletListMarker: "-",
      linkify: false,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: false,
    }),
  ];
}

// Minimal views of markdown-it and prosemirror-markdown's serializer state,
// which tiptap-markdown hands to `storage.markdown` hooks untyped.
interface MarkdownIt {
  renderer: { rules: Record<string, (tokens: { content: string }[], idx: number) => string> };
}
interface SerializerState {
  inTable?: boolean;
  inTightList?: boolean;
  text(text: string, escape?: boolean): void;
  write(content: string): void;
  closeBlock(node: unknown): void;
  flushClose(size?: number): void;
  render(node: PmNode, parent: PmNode, index: number): void;
}
interface PmNode {
  attrs: Record<string, unknown>;
  forEach(f: (child: PmNode, offset: number, index: number) => void): void;
}

/**
 * A list item whose blocks sit on consecutive lines in a tight list. The
 * default puts a blank line between e.g. a paragraph and a code fence, which
 * turns the whole list loose.
 */
function serializeListItem(prefix?: (node: PmNode) => string) {
  return (state: SerializerState, node: PmNode) => {
    if (prefix) state.write(prefix(node));
    node.forEach((child, _offset, index) => {
      if (index > 0 && state.inTightList) state.flushClose(1);
      state.render(child, node, index);
    });
  };
}

const escapeAttribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Text that escapes `|` inside table cells, where it would split the cell. */
const SpaceText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: { text: string }) {
          const text = node.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
          if (!state.inTable) return state.text(text);
          text.split("|").forEach((part, index) => {
            if (index > 0) state.write("\\|");
            if (part) state.text(part);
          });
        },
      },
    };
  },
});

/**
 * Raw HTML in a page (comments, `<details>`, `<kbd>`, …) has no editable form;
 * keep each tag exactly as written and show it as a chip.
 */
function rawHtmlNode(name: string, inline: boolean) {
  const tag = inline ? "span" : "div";
  return Node.create({
    name,
    group: inline ? "inline" : "block",
    inline,
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        html: {
          default: "",
          parseHTML: (element) => element.getAttribute("data-raw-html") ?? "",
          renderHTML: (attributes) => ({ "data-raw-html": attributes.html as string }),
        },
      };
    },
    parseHTML: () => [{ tag: `${tag}[data-raw-html]` }],
    renderHTML: ({ HTMLAttributes, node }) => [
      tag,
      { ...HTMLAttributes, class: "space-raw-html", contenteditable: "false" },
      String(node.attrs.html).trim(),
    ],
    addStorage() {
      return {
        markdown: {
          serialize(state: SerializerState, node: { attrs: { html: string } }) {
            if (inline) {
              state.write(node.attrs.html);
            } else {
              state.write(node.attrs.html.replace(/\n+$/, ""));
              state.closeBlock(node);
            }
          },
        },
      };
    },
  });
}

const RawHtmlBlock = rawHtmlNode("rawHtmlBlock", false);
const RawHtmlInline = rawHtmlNode("rawHtmlInline", true);

const SpaceMarkdownFixes = Extension.create({
  name: "spaceMarkdownFixes",
  addGlobalAttributes() {
    // tiptap-markdown only tracks tightness on bullet and ordered lists.
    return [
      {
        types: ["taskList"],
        attributes: {
          tight: {
            default: true,
            parseHTML: (element) => element.getAttribute("data-tight") === "true" || !element.querySelector("p"),
            renderHTML: (attributes) => (attributes.tight ? { "data-tight": "true" } : {}),
          },
        },
      },
    ];
  },
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(md: MarkdownIt) {
            const { rules } = md.renderer;
            // tiptap-markdown strips a "\n" that follows any element, which
            // glues `code`\nnext into `code`next. The editor shows a soft
            // break as a space anyway.
            rules.softbreak = () => " ";
            rules.html_block = (tokens, idx) =>
              `<div data-raw-html="${escapeAttribute(tokens[idx]!.content)}"></div>`;
            rules.html_inline = (tokens, idx) => {
              const { content } = tokens[idx]!;
              // markdown-it-task-lists emits its checkbox as inline HTML.
              return /^<input\b[^>]*task-list-item-checkbox/.test(content)
                ? content
                : `<span data-raw-html="${escapeAttribute(content)}"></span>`;
            };
          },
        },
      },
    };
  },
});

/** Leading YAML frontmatter, kept verbatim outside the editor. */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = /^(?:﻿)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(content);
  if (match === null) return { frontmatter: "", body: content };
  return { frontmatter: match[0], body: content.slice(match[0].length) };
}

export function getEditorMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown: { getMarkdown(): string } };
  return storage.markdown.getMarkdown();
}

/** Ends serialized Markdown with exactly one newline, like files on disk. */
export function withTrailingNewline(markdown: string): string {
  return markdown.replace(/\s*$/, "\n");
}

/** Parses and re-serializes `content` with no edits (used by tests). */
export function roundTripMarkdown(content: string): string {
  const { frontmatter, body } = splitFrontmatter(content);
  const editor = new Editor({ extensions: markdownExtensions(), content: body });
  try {
    return frontmatter + withTrailingNewline(getEditorMarkdown(editor));
  } finally {
    editor.destroy();
  }
}
