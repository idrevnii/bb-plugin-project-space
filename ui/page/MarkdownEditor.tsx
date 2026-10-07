// WYSIWYG editing for space Markdown: TipTap with the schema from
// markdown-extensions.ts, styled with the same token classes as MarkdownView
// so switching between reading and editing does not jump.
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { encodeSpacePath, resolveSpaceLink } from "../../lib/space";
import { useReadingStyle } from "../reading-style";
import { getEditorMarkdown, markdownExtensions, splitFrontmatter, withTrailingNewline } from "./markdown-extensions";

// Mirrors MarkdownView's component classes, applied to ProseMirror's DOM.
const DOCUMENT_CLASSES = cn(
  "min-h-full text-[15px] text-foreground outline-none",
  "[&_h1]:mt-2 [&_h1]:mb-6 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight",
  "[&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-2 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight",
  "[&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:text-xl [&_h3]:font-semibold",
  "[&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-semibold",
  "[&_h5]:mt-6 [&_h5]:mb-2 [&_h5]:text-sm [&_h5]:font-semibold",
  "[&_h6]:mt-6 [&_h6]:mb-2 [&_h6]:text-sm [&_h6]:font-semibold [&_h6]:text-muted-foreground",
  "[&_p]:my-4 [&_p]:leading-7",
  "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6 [&_ul]:marker:text-muted-foreground",
  "[&_ol]:my-4 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6 [&_ol]:marker:text-muted-foreground",
  "[&_li]:leading-7 [&_li>ol]:my-1.5 [&_li>ul]:my-1.5",
  // Tight lists: list item paragraphs sit flush like the reader's.
  "[&_[data-tight=true]>li>p]:my-0 [&_[data-tight=true]>li>div>p]:my-0",
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-1",
  "[&_[data-type=taskList]>li]:flex [&_[data-type=taskList]>li]:items-start [&_[data-type=taskList]>li]:gap-2",
  "[&_[data-type=taskList]>li>label]:mt-[5px] [&_[data-type=taskList]>li>div]:min-w-0 [&_[data-type=taskList]>li>div]:flex-1",
  "[&_input[type=checkbox]]:size-3.5 [&_input[type=checkbox]]:accent-current",
  "[&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote>p]:my-2",
  "[&_hr]:my-8 [&_hr]:border-border",
  "[&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-lg [&_table]:text-sm [&_table]:outline [&_table]:outline-1 [&_table]:outline-border",
  "[&_th]:border-b [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold",
  "[&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_tr:last-child_td]:border-b-0",
  "[&_td>p]:my-0 [&_th>p]:my-0 [&_.selectedCell]:bg-muted",
  "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:leading-6",
  "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.85em]",
  "[&_a]:text-primary [&_a]:underline [&_a]:decoration-primary/40 [&_a]:underline-offset-2",
  "[&_img.space-image]:my-4 [&_img.space-image]:inline-block [&_img.space-image]:max-w-full [&_img.space-image]:rounded-lg [&_img.space-image]:border [&_img.space-image]:border-border [&_img.ProseMirror-selectednode]:ring-2 [&_img.ProseMirror-selectednode]:ring-ring",
  "[&_.space-raw-html]:rounded [&_.space-raw-html]:bg-muted [&_.space-raw-html]:px-1.5 [&_.space-raw-html]:py-0.5 [&_.space-raw-html]:font-mono [&_.space-raw-html]:text-xs [&_.space-raw-html]:text-muted-foreground",
  "[&_div.space-raw-html]:my-4 [&_div.space-raw-html]:block [&_div.space-raw-html]:whitespace-pre-wrap",
);

export interface MarkdownEditorProps {
  /** Markdown the editor starts from; later changes need a remount (`key`). */
  initialContent: string;
  /** Space-relative path of the document; relative images resolve from it. */
  path: string;
  previewBaseUrl: string | null;
  /** Full file text (frontmatter kept verbatim) after each edit. */
  onChange: (markdown: string) => void;
  onSave: () => void;
}

export function MarkdownEditor({ initialContent, path, previewBaseUrl, onChange, onSave }: MarkdownEditorProps) {
  const [{ frontmatter, body }] = useState(() => splitFrontmatter(initialContent));
  // Latest callbacks without rebuilding the editor.
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };
  const readingStyle = useReadingStyle();

  const editor = useEditor(
    {
      extensions: markdownExtensions({
        resolveImage: (src) => {
          const target = resolveSpaceLink(path, src);
          if (target === null) return src;
          return previewBaseUrl === null ? undefined : previewBaseUrl + encodeSpacePath(target.path);
        },
      }),
      content: body,
      autofocus: "start",
      editorProps: {
        attributes: { class: DOCUMENT_CLASSES, spellcheck: "true", "aria-label": `Edit ${path}` },
        handleKeyDown: (_view, event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            handlers.current.onSave();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => {
        handlers.current.onChange(frontmatter + withTrailingNewline(getEditorMarkdown(editor)));
      },
    },
    [path, previewBaseUrl, frontmatter, body],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {editor ? <FormatBar editor={editor} /> : null}
      <div className="min-h-0 flex-1 overflow-y-auto" onClick={() => editor?.commands.focus()}>
        <div
          className="mx-auto w-full max-w-3xl px-6 py-8 md:px-10"
          data-reading-style={readingStyle}
          onClick={(event) => event.stopPropagation()}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

function FormatBar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      heading: editor.isActive("heading"),
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      strike: editor.isActive("strike"),
      highlight: editor.isActive("highlight"),
      code: editor.isActive("code"),
      link: editor.isActive("link"),
      href: String(editor.getAttributes("link").href ?? ""),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      taskList: editor.isActive("taskList"),
      codeBlock: editor.isActive("codeBlock"),
      blockquote: editor.isActive("blockquote"),
      table: editor.isActive("table"),
    }),
  });
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const chain = () => editor.chain().focus();

  const applyLink = () => {
    const href = (linkDraft ?? "").trim();
    if (href === "") chain().extendMarkRange("link").unsetLink().run();
    else if (editor.state.selection.empty && !state.link) {
      chain().insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    } else chain().extendMarkRange("link").setLink({ href }).run();
    setLinkDraft(null);
  };

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-border bg-background px-3 py-1"
    >
      <FormatButton label="Heading" active={state.heading} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
        H
      </FormatButton>
      <FormatButton label="Bold" active={state.bold} onClick={() => chain().toggleBold().run()}>
        <span className="font-bold">B</span>
      </FormatButton>
      <FormatButton label="Italic" active={state.italic} onClick={() => chain().toggleItalic().run()}>
        <span className="italic">I</span>
      </FormatButton>
      <FormatButton label="Strikethrough" active={state.strike} onClick={() => chain().toggleStrike().run()}>
        <span className="line-through">S</span>
      </FormatButton>
      <FormatButton label="Highlight" active={state.highlight} onClick={() => chain().toggleHighlight().run()}>
        <mark className="rounded-sm bg-yellow-300/60 px-0.5 text-current">H</mark>
      </FormatButton>
      <FormatButton label="Inline code" active={state.code} onClick={() => chain().toggleCode().run()}>
        <span className="font-mono">`</span>
      </FormatButton>
      <FormatButton label="Link" active={state.link || linkDraft !== null} onClick={() => setLinkDraft(state.href)}>
        Link
      </FormatButton>
      <Divider />
      <FormatButton label="Bullet list" active={state.bulletList} onClick={() => chain().toggleBulletList().run()}>
        •
      </FormatButton>
      <FormatButton label="Numbered list" active={state.orderedList} onClick={() => chain().toggleOrderedList().run()}>
        1.
      </FormatButton>
      <FormatButton label="Task list" active={state.taskList} onClick={() => chain().toggleTaskList().run()}>
        ☐
      </FormatButton>
      <FormatButton label="Quote" active={state.blockquote} onClick={() => chain().toggleBlockquote().run()}>
        ❝
      </FormatButton>
      <FormatButton label="Code block" active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
        <span className="font-mono">{"{}"}</span>
      </FormatButton>
      <FormatButton
        label="Table"
        active={state.table}
        onClick={() => chain().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()}
      >
        Table
      </FormatButton>
      {state.table ? (
        <>
          <FormatButton label="Add row" onClick={() => chain().addRowAfter().run()}>
            +Row
          </FormatButton>
          <FormatButton label="Add column" onClick={() => chain().addColumnAfter().run()}>
            +Col
          </FormatButton>
          <FormatButton label="Delete row" onClick={() => chain().deleteRow().run()}>
            −Row
          </FormatButton>
          <FormatButton label="Delete column" onClick={() => chain().deleteColumn().run()}>
            −Col
          </FormatButton>
        </>
      ) : null}
      {linkDraft !== null ? (
        <form
          className="ml-2 flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink();
          }}
        >
          <input
            autoFocus
            aria-label="Link URL"
            placeholder="https://… or other-page.md"
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setLinkDraft(null);
                editor.commands.focus();
              }
            }}
            className="h-7 w-64 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
          />
          <Button type="submit" size="sm" variant="outline">
            Apply
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function FormatButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      // Keep the editor selection while clicking.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-border" />;
}
