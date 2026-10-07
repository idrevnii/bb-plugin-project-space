// Annotations on a rendered Markdown page: select text, press *Comment*,
// write a note. Anchors are quotes against the article's rendered text (not
// the source), found again with `locateQuote` after every render and painted
// with the CSS Custom Highlight API, so the page's DOM stays React's. Where
// that API is missing, the ranges are wrapped in <mark> instead. Clicking a
// highlight opens its comment; quotes no longer found are listed under the
// page title. architecture/annotations.md in the space has the contract.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MAX_COMMENT_LENGTH,
  locateQuote,
  quoteSelector,
  type Annotation,
  type QuoteSelector,
  type TextRange,
} from "../../lib/annotations";
import { useAnnotations, type SpaceRpc } from "../data";
import { CommentCard, CommentEditor } from "./comment";
import { takeAnnotationFocus, useAnnotationFocus } from "./focus";
import "./markdown.css";
import { highlights, offsetOf, rangeOf, supportsHighlights, textModel, unwrapMarks, wrapMarks } from "./text";

/** `::highlight()` names, also the <mark> classes in markdown.css. */
const HIGHLIGHTS = {
  open: "space-annotation",
  resolved: "space-annotation-resolved",
  active: "space-annotation-active",
} as const;

const HIGHLIGHT_CSS = `
::highlight(${HIGHLIGHTS.open}) { background-color: rgb(250 204 21 / 0.3); }
::highlight(${HIGHLIGHTS.active}) { background-color: rgb(250 204 21 / 0.6); }
::highlight(${HIGHLIGHTS.resolved}) {
  text-decoration: underline dotted rgb(250 204 21 / 0.8);
  text-decoration-thickness: 2px;
}`;

/** Adds the ::highlight() rules to the page once. */
function installHighlightStyles() {
  const id = "space-annotation-highlights";
  if (document.getElementById(id) !== null) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = HIGHLIGHT_CSS;
  document.head.append(style);
}
const POPOVER_WIDTH = 320;

// ── Locating and painting ────────────────────────────────────────────────────

type Located = ReadonlyMap<string, TextRange | null>;

/**
 * Finds every text-quote annotation in the article's text after each render
 * and paints it. A MutationObserver catches later renders (live refresh,
 * code blocks and diagrams that fill in after mount).
 */
function useHighlights(article: HTMLElement | null, annotations: Annotation[] | null, activeId: string | null) {
  const [located, setLocated] = useState<Located>(new Map());
  const cache = useRef<{ text: string; annotations: Annotation[]; located: Located } | null>(null);

  useLayoutEffect(() => {
    if (article === null || annotations === null) return;
    const quoted = annotations.filter((each) => each.anchor.kind === "text-quote");
    const marks = !supportsHighlights();
    if (!marks) installHighlightStyles();
    let frame = 0;

    const apply = () => {
      if (marks) {
        observer.disconnect();
        unwrapMarks(article);
      }
      const model = textModel(article);
      let current = cache.current;
      if (current === null || current.text !== model.text || current.annotations !== annotations) {
        current = {
          text: model.text,
          annotations,
          located: new Map(
            quoted.map((each) => [each.id, each.anchor.kind === "text-quote" ? locateQuote(model.text, each.anchor) : null]),
          ),
        };
        cache.current = current;
        setLocated(current.located);
      }
      const painted = quoted.flatMap((each) => {
        const range = current.located.get(each.id);
        if (range == null) return [];
        const name = each.id === activeId ? HIGHLIGHTS.active : each.status === "resolved" ? HIGHLIGHTS.resolved : HIGHLIGHTS.open;
        return [{ id: each.id, range, name }];
      });
      if (marks) {
        wrapMarks(model, painted.map(({ id, range, name }) => ({ id, range, className: name })));
        observer.observe(article, OBSERVE);
        return;
      }
      for (const name of Object.values(HIGHLIGHTS)) {
        const ranges = painted.flatMap((each) => {
          const range = each.name === name ? rangeOf(model, each.range) : null;
          return range === null ? [] : [range];
        });
        const highlight = new Highlight(...ranges);
        if (name === HIGHLIGHTS.active) highlight.priority = 1;
        highlights().set(name, highlight);
      }
    };

    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    apply();
    observer.observe(article, OBSERVE);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      if (marks) unwrapMarks(article);
      else for (const name of Object.values(HIGHLIGHTS)) highlights().delete(name);
    };
  }, [article, annotations, activeId]);

  return located;
}

const OBSERVE: MutationObserverInit = { childList: true, subtree: true, characterData: true };

// ── UI ───────────────────────────────────────────────────────────────────────

interface Point {
  top: number;
  left: number;
}

type Popover =
  | { kind: "new"; selector: QuoteSelector; at: Point }
  | { kind: "open"; id: string; at: Point };

function quoteOf(annotation: Annotation): string {
  return annotation.anchor.kind === "text-quote" ? annotation.anchor.exact : "";
}

/** Comments that are not on a passage still found on the page. */
export function UnplacedList({
  orphans,
  pageNotes,
  onOpen,
}: {
  orphans: Annotation[];
  pageNotes: Annotation[];
  onOpen: (id: string, element: HTMLElement) => void;
}) {
  const group = (title: string, items: Annotation[], testId: string) =>
    items.length === 0 ? null : (
      <div data-testid={testId}>
        <div className="mb-1 font-medium text-muted-foreground">{title}</div>
        <ul className="flex flex-col gap-1">
          {items.map((each) => (
            <li key={each.id}>
              <button
                type="button"
                data-annotation-id={each.id}
                onClick={(event) => onOpen(each.id, event.currentTarget)}
                className={cn(
                  "w-full truncate rounded px-1.5 py-0.5 text-left hover:bg-state-hover",
                  each.status === "resolved" && "text-muted-foreground",
                )}
              >
                {quoteOf(each) !== "" ? (
                  <span className="text-muted-foreground line-through">“{quoteOf(each)}”</span>
                ) : null}{" "}
                {each.comment}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  if (orphans.length === 0 && pageNotes.length === 0) return null;
  return (
    <div className="not-prose my-4 flex flex-col gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs">
      {group("Comments on the whole page", pageNotes, "page-annotations")}
      {group(
        orphans.length === 1 ? "1 comment whose text is gone" : `${orphans.length} comments whose text is gone`,
        orphans,
        "orphaned-annotations",
      )}
    </div>
  );
}

/**
 * Wraps a Markdown reader with annotations. `children` renders the reader
 * and receives the article ref and the title slot to pass to MarkdownView.
 */
export function AnnotatedMarkdown({
  projectId,
  path,
  rpc,
  children,
}: {
  projectId: string;
  path: string;
  rpc: SpaceRpc;
  children: (props: { articleRef: (element: HTMLElement | null) => void; titleSlot: ReactNode }) => ReactNode;
}) {
  const { annotations, refetch } = useAnnotations(projectId, path);
  const [article, setArticle] = useState<HTMLElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<{ selector: QuoteSelector; at: Point } | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const activeId = popover?.kind === "open" ? popover.id : null;
  const located = useHighlights(article, annotations, activeId);

  const relative = useCallback((x: number, y: number): Point => {
    const box = wrap.current?.getBoundingClientRect();
    return { top: y - (box?.top ?? 0), left: x - (box?.left ?? 0) };
  }, []);

  // Offer *Comment* for a non-empty selection inside the article.
  useEffect(() => {
    if (article === null) return;
    let frame = 0;
    const update = () => {
      const current = document.getSelection();
      const range = current !== null && current.rangeCount > 0 && !current.isCollapsed ? current.getRangeAt(0) : null;
      const inside = (node: Node) =>
        article.contains(node) && !(node instanceof Element ? node : node.parentElement)?.closest("[data-annotate-skip]");
      if (range === null || !inside(range.startContainer) || !inside(range.endContainer)) {
        setSelection(null);
        return;
      }
      const model = textModel(article);
      let start = offsetOf(model, range.startContainer, range.startOffset);
      let end = offsetOf(model, range.endContainer, range.endOffset);
      while (start < end && /\s/.test(model.text[start]!)) start++;
      while (end > start && /\s/.test(model.text[end - 1]!)) end--;
      if (start >= end) {
        setSelection(null);
        return;
      }
      const rects = range.getClientRects();
      const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
      setSelection({
        selector: quoteSelector(model.text, start, Math.min(end, start + MAX_COMMENT_LENGTH)),
        at: relative(last.right, last.bottom + 6),
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    document.addEventListener("selectionchange", schedule);
    return () => {
      document.removeEventListener("selectionchange", schedule);
      cancelAnimationFrame(frame);
    };
  }, [article, relative]);

  // A click on a highlight opens its comment.
  useEffect(() => {
    if (article === null || annotations === null) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("a, button, input, summary, [data-annotate-skip]")) return;
      if (document.getSelection()?.isCollapsed === false) return;
      const model = textModel(article);
      const hits = annotations.flatMap((each) => {
        const found = located.get(each.id);
        const range = found == null ? null : rangeOf(model, found);
        if (range === null) return [];
        const over = Array.from(range.getClientRects()).some(
          (rect) =>
            event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom,
        );
        return over ? [{ id: each.id, length: found!.end - found!.start }] : [];
      });
      if (hits.length === 0) return;
      // The innermost of overlapping highlights.
      hits.sort((a, b) => a.length - b.length);
      setPopover({ kind: "open", id: hits[0]!.id, at: relative(event.clientX, event.clientY + 14) });
    };
    article.addEventListener("click", onClick);
    return () => article.removeEventListener("click", onClick);
  }, [article, annotations, located, relative]);

  // An open comment closes on a click elsewhere; a draft only on Cancel/Esc.
  useEffect(() => {
    if (popover?.kind !== "open") return;
    const onDown = (event: MouseEvent) => {
      if (!card.current?.contains(event.target as Node)) setPopover(null);
    };
    const onKey = (event: KeyboardEvent) => {
      // The comment editor handles its own Esc (leave editing) and marks it.
      if (event.key === "Escape" && !event.defaultPrevented) setPopover(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popover?.kind]);

  const { orphans, pageNotes } = useMemo(() => {
    const list = annotations ?? [];
    return {
      orphans: list.filter(
        (each) => each.anchor.kind === "shapes" || (located.has(each.id) && located.get(each.id) === null),
      ),
      pageNotes: list.filter((each) => each.anchor.kind === "file"),
    };
  }, [annotations, located]);

  // The Review tab asked to show one: scroll to it and open its comment.
  const focusId = useAnnotationFocus(projectId, path);
  useEffect(() => {
    if (focusId === null || article === null || annotations === null) return;
    const annotation = annotations.find((each) => each.id === focusId);
    // Not listed yet, or its quote not looked for yet: wait for the next pass.
    if (annotation === undefined || (annotation.anchor.kind === "text-quote" && !located.has(focusId))) return;
    const found = located.get(focusId);
    const range = found == null ? null : rangeOf(textModel(article), found);
    if (range !== null) {
      range.startContainer.parentElement?.scrollIntoView({ block: "center" });
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      setPopover({ kind: "open", id: focusId, at: relative(rect.left + rect.width / 2, rect.bottom + 14) });
    } else {
      const item = wrap.current?.querySelector(`[data-annotation-id="${CSS.escape(focusId)}"]`);
      if (item == null) return;
      item.scrollIntoView({ block: "center" });
      const box = item.getBoundingClientRect();
      setPopover({ kind: "open", id: focusId, at: relative(box.left + POPOVER_WIDTH / 2, box.bottom + 4) });
    }
    takeAnnotationFocus(focusId);
  }, [focusId, article, annotations, located, relative]);

  const openAnnotation = popover?.kind === "open" ? annotations?.find((each) => each.id === popover.id) : undefined;
  useEffect(() => {
    // Deleted meanwhile (here or elsewhere).
    if (popover?.kind === "open" && annotations !== null && openAnnotation === undefined) setPopover(null);
  }, [popover, annotations, openAnnotation]);

  const width = wrap.current?.clientWidth ?? POPOVER_WIDTH;
  const place = (at: Point, own: number) => ({
    top: at.top,
    left: Math.max(0, Math.min(at.left - own / 2, width - own)),
  });

  const titleSlot = (
    <UnplacedList
      orphans={orphans}
      pageNotes={pageNotes}
      onOpen={(id, element) => {
        const box = element.getBoundingClientRect();
        setPopover({ kind: "open", id, at: relative(box.left + POPOVER_WIDTH / 2, box.bottom + 4) });
      }}
    />
  );

  return (
    <div ref={wrap} className="relative">
      {children({ articleRef: setArticle, titleSlot })}
      {selection !== null && popover === null ? (
        <Button
          size="sm"
          variant="outline"
          data-annotate-skip=""
          className="absolute z-20 h-7 bg-popover px-2 shadow-md"
          style={place(selection.at, 90)}
          // Keep the selection while the button takes the click.
          onMouseDown={(event) => event.preventDefault()}
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
          data-annotate-skip=""
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
                  document.getSelection()?.removeAllRanges();
                  setPopover(null);
                  refetch();
                }}
              />
            </>
          ) : (
            <CommentCard
              key={openAnnotation!.id}
              annotation={openAnnotation!}
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
