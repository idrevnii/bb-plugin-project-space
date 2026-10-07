import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { experimental_SourceCode as SourceCode } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { baseName, fileKind } from "../../lib/space";
import type { SpaceFile } from "../../server";
import { useAnnotationFocus } from "../annotate/focus";
import { AnnotatedHtml } from "../annotate/html";
import { AnnotatedMarkdown } from "../annotate/markdown";
import { errorMessage, type SpaceRpc } from "../data";
import { MarkdownView } from "../MarkdownView";
import { outlineKey, useHeadingTracker } from "../outline";
import { HtmlFrame } from "./HtmlFrame";
import { MarkdownEditor } from "./MarkdownEditor";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

/** View/edit for text documents (markdown, html, plain text). */
export function TextDocument({
  projectId,
  file,
  rpc,
  previewBaseUrl,
  onOpenSpacePath,
  checkout,
  spaceHas,
  toolbar,
}: {
  projectId: string;
  file: SpaceFile;
  rpc: SpaceRpc;
  previewBaseUrl: string | null;
  onOpenSpacePath: (path: string, hash: string) => void;
  checkout: { hostId: string; path: string } | null;
  spaceHas: ((path: string) => boolean) | undefined;
  toolbar: (controls: ReactNode) => ReactNode;
}) {
  const kind = fileKind(file.path);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.content);
  /** The version the draft is based on; saves compare-and-swap against it. */
  const [baseSha, setBaseSha] = useState(file.sha256);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  /** Markdown edits in place by default; Source swaps to the textarea. */
  const [source, setSource] = useState(false);
  /** Bumped when the draft is replaced from outside, so the editor reloads it. */
  const [editorKey, setEditorKey] = useState(0);
  const wysiwyg = editing && kind === "markdown" && !source;
  /** HTML only: render through the annotation bridge instead of the plain preview. */
  const [annotate, setAnnotate] = useState(false);
  // The Review tab opening a comment on this page switches it on.
  const focusId = useAnnotationFocus(projectId, file.path);
  useEffect(() => {
    if (focusId !== null && kind === "html" && !editing) setAnnotate(true);
  }, [focusId, kind, editing]);
  /** The reader's scroll container, for the Outline tab's highlight. */
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  useHeadingTracker(
    outlineKey(projectId, file.path),
    kind === "markdown" && !editing ? scroller : null,
    file.content,
  );

  // Follow outside changes while not editing.
  useEffect(() => {
    if (!editing) {
      setDraft(file.content);
      setBaseSha(file.sha256);
    } else if (file.sha256 !== baseSha && draft === file.content) {
      setBaseSha(file.sha256);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const outsideChange = editing && file.sha256 !== baseSha;

  const doSave = useCallback(
    async (force = false) => {
      setSave({ kind: "saving" });
      try {
        const result = await rpc.call("space_write", {
          projectId,
          path: file.path,
          content: draft,
          ...(force ? {} : { expectedSha256: baseSha }),
        });
        if (result.outcome === "written") {
          setBaseSha(result.sha256);
          setSave({ kind: "idle" });
        } else {
          setSave({ kind: "conflict" });
        }
      } catch (cause) {
        setSave({ kind: "error", message: errorMessage(cause) });
      }
    },
    [rpc, projectId, file.path, draft, baseSha],
  );

  const textarea = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (editing) textarea.current?.focus();
  }, [editing]);

  const controls = (
    <>
      {editing ? (
        <>
          <span className="text-xs text-muted-foreground">
            {save.kind === "saving" ? "Saving…" : draft !== file.content || baseSha !== file.sha256 ? "Unsaved" : "Saved"}
          </span>
          {kind === "markdown" ? (
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={source}
              onClick={() => {
                if (source) setEditorKey((key) => key + 1);
                setSource(!source);
              }}
            >
              Source
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => void doSave()}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setDraft(file.content);
              setBaseSha(file.sha256);
              setSave({ kind: "idle" });
            }}
          >
            Done
          </Button>
        </>
      ) : (
        <>
          {kind === "html" ? (
            <Button size="sm" variant="ghost" aria-pressed={annotate} onClick={() => setAnnotate(!annotate)}>
              <Icon name="MessageSquare" className="size-3.5" />
              Annotate
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          <Icon name="Edit" className="size-3.5" />
          Edit
          </Button>
        </>
      )}
    </>
  );

  const banner =
    save.kind === "conflict" || outsideChange ? (
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-xs">
        <span className="flex-1">This file changed on disk since you started editing.</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft(file.content);
            setBaseSha(file.sha256);
            setSave({ kind: "idle" });
            setEditorKey((key) => key + 1);
          }}
        >
          Discard mine
        </Button>
        <Button size="sm" variant="outline" onClick={() => void doSave(true)}>
          Overwrite
        </Button>
      </div>
    ) : save.kind === "error" ? (
      <div role="alert" className="border-b border-border px-4 py-2 text-xs text-destructive">
        {save.message}
      </div>
    ) : null;

  const markdown = (annotate?: { articleRef: (element: HTMLElement | null) => void; titleSlot: ReactNode }) => (
    <MarkdownView
      content={editing ? draft : file.content}
      path={file.path}
      previewBaseUrl={previewBaseUrl}
      onOpenSpacePath={onOpenSpacePath}
      checkout={checkout}
      spaceHas={spaceHas}
      {...annotate}
    />
  );
  const reader =
    kind === "markdown" ? (
      <div className="mx-auto w-full max-w-3xl px-6 py-8 md:px-10">
        {editing ? (
          markdown()
        ) : (
          <AnnotatedMarkdown key={file.path} projectId={projectId} path={file.path} rpc={rpc}>
            {markdown}
          </AnnotatedMarkdown>
        )}
      </div>
    ) : kind === "html" ? (
      annotate ? (
        <AnnotatedHtml key={file.path} projectId={projectId} file={file} rpc={rpc} baseUrl={previewBaseUrl} />
      ) : (
        <HtmlFrame baseUrl={previewBaseUrl} file={file} />
      )
    ) : (
      <div className="p-4 text-[13px]">
        <SourceCode content={file.content} path={file.path} overflow="wrap" />
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {toolbar(controls)}
      {banner}
      {wysiwyg ? (
        <MarkdownEditor
          key={editorKey}
          initialContent={draft}
          path={file.path}
          previewBaseUrl={previewBaseUrl}
          onChange={setDraft}
          onSave={() => void doSave()}
        />
      ) : editing ? (
        <div className={cn("grid min-h-0 flex-1", kind === "markdown" || kind === "html" ? "md:grid-cols-2" : "grid-cols-1")}>
          <textarea
            ref={textarea}
            value={draft}
            spellCheck={kind === "markdown"}
            aria-label={`Edit ${baseName(file.path)}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                void doSave();
              }
            }}
            className="min-h-0 resize-none border-r border-border bg-background p-6 font-mono text-[13px] leading-6 text-foreground outline-none"
          />
          {kind === "markdown" || kind === "html" ? (
            <div className="hidden min-h-0 overflow-y-auto md:block">
              {kind === "html" ? <HtmlFrame baseUrl={previewBaseUrl} file={file} srcDoc={draft} /> : reader}
            </div>
          ) : null}
        </div>
      ) : (
        <div ref={setScroller} className={cn("min-h-0 flex-1", kind === "html" ? "flex flex-col" : "overflow-y-auto")}>{reader}</div>
      )}
    </div>
  );
}
