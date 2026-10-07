// Annotations on an HTML page in *Annotate* mode. The page stays in its
// sandbox (no allow-same-origin), so everything goes through the bridge in
// html-bridge.ts: it reports the page's rendered text and the user's
// selections, and paints the highlights this side locates with `locateQuote`.
// The popover and the *Comment* button live here, over the frame, and are the
// only way to create an annotation: a message from the page can at most offer
// the button, never write. architecture/annotations.md has the contract.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MAX_COMMENT_LENGTH, QUOTE_CONTEXT, locateQuote, type Annotation, type QuoteSelector, type TextRange } from "../../lib/annotations";
import type { SpaceFile } from "../../server";
import { useAnnotations, type SpaceRpc } from "../data";
import { HtmlFrame } from "../page/HtmlFrame";
import { CommentCard, CommentEditor } from "./comment";
import { takeAnnotationFocus, useAnnotationFocus } from "./focus";
import { parseBridgeMessage, toBridge, type BridgeConfig, type BridgeRect, type ParentMessage } from "./html-bridge";
import { UnplacedList } from "./markdown";

const POPOVER_WIDTH = 320;

interface Point {
  top: number;
  left: number;
}

type Popover =
  | { kind: "new"; selector: QuoteSelector; at: Point }
  | { kind: "open"; id: string; at: Point };

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function AnnotatedHtml({
  projectId,
  file,
  rpc,
  baseUrl,
}: {
  projectId: string;
  file: SpaceFile;
  rpc: SpaceRpc;
  baseUrl: string | null;
}) {
  const path = file.path;
  const { annotations, refetch } = useAnnotations(projectId, path);
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  /** The page's rendered text as the bridge last sent it; a new object each time, so a reload repaints. */
  const [page, setPage] = useState<{ text: string } | null>(null);
  const [selection, setSelection] = useState<{ selector: QuoteSelector; at: Point } | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const activeId = popover?.kind === "open" ? popover.id : null;

  const [token] = useState(randomToken);
  const config = useMemo<BridgeConfig>(
    () => ({
      token,
      context: QUOTE_CONTEXT,
      maxQuote: MAX_COMMENT_LENGTH,
      names: { open: "space-annotation", resolved: "space-annotation-resolved", active: "space-annotation-active" },
    }),
    [token],
  );

  const send = useCallback(
    (message: ParentMessage) => frame?.contentWindow?.postMessage(toBridge(message), "*"),
    [frame],
  );

  /** A rect in the frame's viewport, as a point in the wrapper. */
  const pointOf = useCallback(
    (rect: BridgeRect, x: number, y: number): Point => {
      const box = frame?.getBoundingClientRect();
      const outer = wrap.current?.getBoundingClientRect();
      return { top: (box?.top ?? 0) + y - (outer?.top ?? 0), left: (box?.left ?? 0) + x - (outer?.left ?? 0) };
    },
    [frame],
  );

  // Messages from the bridge: only from this frame's window, with this
  // mount's token, in the expected shape.
  useEffect(() => {
    if (frame === null) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source === null || event.source !== frame.contentWindow) return;
      const message = parseBridgeMessage(event.data, token);
      if (message === null) return;
      if (message.type === "text") setPage({ text: message.text });
      else if (message.type === "unselect") setSelection(null);
      else if (message.type === "selection") {
        const { exact, prefix, suffix, rect } = message;
        setSelection({ selector: { exact, prefix, suffix }, at: pointOf(rect, rect.right, rect.bottom + 6) });
      } else if (message.type === "click") {
        setPopover({ kind: "open", id: message.id, at: pointOf(message.rect, message.rect.left, message.rect.bottom + 14) });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame, token, pointOf]);

  // A new document in the frame (the file changed) starts without text.
  useEffect(() => {
    setPage(null);
    setSelection(null);
  }, [file.sha256]);

  const located = useMemo(() => {
    const map = new Map<string, TextRange | null>();
    if (page === null || annotations === null) return map;
    for (const each of annotations) {
      if (each.anchor.kind === "text-quote") map.set(each.id, locateQuote(page.text, each.anchor));
    }
    return map;
  }, [page, annotations]);

  // Paint after every text report, list change, or change of the open one.
  useEffect(() => {
    if (page === null || annotations === null) return;
    send({
      type: "highlight",
      annotations: annotations.flatMap((each) => {
        const range = located.get(each.id);
        if (range == null) return [];
        const state = each.id === activeId ? "active" : each.status === "resolved" ? "resolved" : "open";
        return [{ id: each.id, start: range.start, end: range.end, state }];
      }),
    });
  }, [page, annotations, located, activeId, send]);

  // An open comment closes on a click elsewhere, in bb or in the page; a
  // draft only on Cancel/Esc.
  useEffect(() => {
    if (popover?.kind !== "open") return;
    const onDown = (event: MouseEvent) => {
      if (!card.current?.contains(event.target as Node)) setPopover(null);
    };
    const onKey = (event: KeyboardEvent) => {
      // The comment editor handles its own Esc (leave editing) and marks it.
      if (event.key === "Escape" && !event.defaultPrevented) setPopover(null);
    };
    // Focus moving into the frame is the only sign of a click inside it.
    const onBlur = () => {
      setTimeout(() => {
        if (document.activeElement === frame) setPopover(null);
      });
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [popover?.kind, frame]);

  const { orphans, pageNotes } = useMemo(() => {
    const list = annotations ?? [];
    return {
      orphans: list.filter((each) => each.anchor.kind === "shapes" || (located.has(each.id) && located.get(each.id) === null)),
      pageNotes: list.filter((each) => each.anchor.kind === "file"),
    };
  }, [annotations, located]);

  const openNear = useCallback((id: string, element: Element) => {
    const box = element.getBoundingClientRect();
    const outer = wrap.current?.getBoundingClientRect();
    setPopover({
      kind: "open",
      id,
      at: { top: box.bottom + 4 - (outer?.top ?? 0), left: box.left + POPOVER_WIDTH / 2 - (outer?.left ?? 0) },
    });
  }, []);

  // The Review tab asked to show one: the bridge scrolls to it and reports
  // where it is, which opens it like a click.
  const focusId = useAnnotationFocus(projectId, path);
  useEffect(() => {
    if (focusId === null || page === null || annotations === null) return;
    const annotation = annotations.find((each) => each.id === focusId);
    if (annotation === undefined) return;
    if (located.get(focusId) != null) {
      send({ type: "reveal", id: focusId });
    } else {
      const item = wrap.current?.querySelector(`[data-annotation-id="${CSS.escape(focusId)}"]`);
      if (item == null) return;
      openNear(focusId, item);
    }
    takeAnnotationFocus(focusId);
  }, [focusId, page, annotations, located, send, openNear]);

  const openAnnotation = popover?.kind === "open" ? annotations?.find((each) => each.id === popover.id) : undefined;
  useEffect(() => {
    if (popover?.kind === "open" && annotations !== null && openAnnotation === undefined) setPopover(null);
  }, [popover, annotations, openAnnotation]);

  const width = wrap.current?.clientWidth ?? POPOVER_WIDTH;
  const place = (at: Point, own: number) => ({
    top: at.top,
    left: Math.max(0, Math.min(at.left - own / 2, width - own)),
  });

  return (
    <div ref={wrap} className="relative flex min-h-0 flex-1 flex-col">
      {orphans.length > 0 || pageNotes.length > 0 ? (
        <div className="max-h-40 shrink-0 overflow-y-auto px-4">
          <UnplacedList orphans={orphans} pageNotes={pageNotes} onOpen={openNear} />
        </div>
      ) : null}
      <HtmlFrame baseUrl={baseUrl} file={file} bridge={config} frameRef={setFrame} />
      {selection !== null && popover === null ? (
        <Button
          size="sm"
          variant="outline"
          className="absolute z-20 h-7 bg-popover px-2 shadow-md"
          style={place(selection.at, 90)}
          onClick={() => {
            setPopover({ kind: "new", selector: selection.selector, at: selection.at });
            setSelection(null);
          }}
        >
          Comment
        </Button>
      ) : null}
      {popover !== null && (popover.kind === "new" || openAnnotation !== undefined) ? (
        <div
          ref={card}
          role="dialog"
          aria-label={popover.kind === "new" ? "New comment" : "Comment"}
          className="absolute z-30 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
          style={{ ...place(popover.at, POPOVER_WIDTH), width: POPOVER_WIDTH }}
        >
          {popover.kind === "new" ? (
            <>
              <blockquote className="mb-2 line-clamp-3 border-l-2 border-border pl-2 text-xs text-muted-foreground">
                {popover.selector.exact}
              </blockquote>
              <CommentEditor
                submitLabel="Save"
                onCancel={() => setPopover(null)}
                onSubmit={async (comment) => {
                  const { selector } = popover;
                  await rpc.call("annotations_create", {
                    projectId,
                    path,
                    anchor: { kind: "text-quote", ...selector },
                    comment,
                  });
                  send({ type: "unselect" });
                  setPopover(null);
                  refetch();
                }}
              />
            </>
          ) : (
            <CommentCard
              key={openAnnotation!.id}
              annotation={openAnnotation as Annotation}
              rpc={rpc}
              projectId={projectId}
              onChanged={refetch}
              onClose={() => setPopover(null)}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
