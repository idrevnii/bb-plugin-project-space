// Annotations on a tldraw canvas: select shapes, press *Comment* (a button
// under the selection, or the context menu), write a note. The anchor is the
// selected shape ids. Each comment shows as a numbered badge at the top-right
// of its shapes' bounds, drawn in tldraw's `InFrontOfTheCanvas` layer so it
// follows the camera and the shapes; clicking it opens the comment. Comments
// whose shapes are all gone are listed in the board's top-left corner.
//
// tldraw's component slots take no props, so TldrawView wraps the board in
// <CanvasAnnotations>, and the slots read it from context.
// architecture/annotations.md in the space has the contract.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Box,
  DefaultContextMenu,
  DefaultContextMenuContent,
  EditorPortal,
  TldrawUiMenuGroup,
  TldrawUiMenuItem,
  useEditor,
  useValue,
  type Editor,
  type TLComponents,
  type TLShapeId,
  type TLUiContextMenuProps,
} from "tldraw";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Annotation } from "../../lib/annotations";
import { useAnnotations, type SpaceRpc } from "../data";
import { CommentCard, CommentEditor } from "./comment";
import { takeAnnotationFocus, useAnnotationFocus } from "./focus";

const POPOVER_WIDTH = 320;
const BADGE_SIZE = 20;
/** Above tldraw's panels (300), below its menus (400). */
const POPOVER_Z = 350;

interface Point {
  x: number;
  y: number;
}

type Popover =
  | { kind: "new"; shapeIds: TLShapeId[] }
  /** `at` is set when opened from the corner list; otherwise it follows the badge. */
  | { kind: "open"; id: string; at?: Point };

interface CanvasAnnotationsState {
  projectId: string;
  path: string;
  rpc: SpaceRpc;
  /** The file's annotations, oldest first; null until loaded. */
  annotations: Annotation[] | null;
  refetch: () => void;
  /** False until the board shows the file; shapes are not looked up before. */
  ready: boolean;
  popover: Popover | null;
  setPopover: (popover: Popover | null) => void;
}

const CanvasAnnotationsContext = createContext<CanvasAnnotationsState | null>(null);

export function CanvasAnnotations({
  projectId,
  path,
  rpc,
  ready,
  children,
}: {
  projectId: string;
  path: string;
  rpc: SpaceRpc;
  ready: boolean;
  children: ReactNode;
}) {
  const { annotations, refetch } = useAnnotations(projectId, path);
  const [popover, setPopover] = useState<Popover | null>(null);
  const value = useMemo(
    () => ({ projectId, path, rpc, annotations, refetch, ready, popover, setPopover }),
    [projectId, path, rpc, annotations, refetch, ready, popover],
  );
  return <CanvasAnnotationsContext.Provider value={value}>{children}</CanvasAnnotationsContext.Provider>;
}

/** Pass to <Tldraw components>; stable, so tldraw does not remount its UI. */
export const canvasAnnotationComponents: TLComponents = {
  InFrontOfTheCanvas: AnnotationLayer,
  ContextMenu: CommentContextMenu,
};

// ── Where things are ─────────────────────────────────────────────────────────

/** Union page bounds of the shapes that exist on the current page. */
function boundsOf(editor: Editor, shapeIds: readonly string[]): Box | null {
  const page = editor.getCurrentPageId();
  const boxes = shapeIds.flatMap((id) => {
    const shapeId = id as TLShapeId;
    if (editor.getShape(shapeId) === undefined || editor.getAncestorPageId(shapeId) !== page) return [];
    const box = editor.getShapePageBounds(shapeId);
    return box === undefined ? [] : [box];
  });
  return boxes.length === 0 ? null : Box.Common(boxes);
}

/** Page bounds → container (viewport) pixels. */
function onScreen(editor: Editor, box: Box): Box {
  const topLeft = editor.pageToViewport({ x: box.minX, y: box.minY });
  const bottomRight = editor.pageToViewport({ x: box.maxX, y: box.maxY });
  return new Box(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
}

type Placement =
  /** Its shapes are on this page; `rect` is their bounds on screen. */
  | { kind: "placed"; rect: Box; badge: Point }
  /** Some of its shapes exist, on another page. */
  | { kind: "elsewhere" }
  /** None of its shapes exist any more. */
  | { kind: "orphaned" }
  /** A `file` or `text-quote` anchor: a comment on the whole canvas. */
  | { kind: "canvas" };

interface Marker {
  annotation: Annotation;
  /** 1-based, by age among the file's comments; the same in badge and list. */
  number: number;
  place: Placement;
}

/** Live placement of every comment; recomputes as the camera or shapes change. */
function useMarkers(editor: Editor, annotations: Annotation[] | null): Marker[] {
  return useValue(
    "space annotation markers",
    () => {
      const taken = new Map<string, number>();
      return (annotations ?? []).map((annotation, index): Marker => {
        const number = index + 1;
        const { anchor } = annotation;
        if (anchor.kind !== "shapes") return { annotation, number, place: { kind: "canvas" } };
        const page = boundsOf(editor, anchor.shapeIds);
        if (page === null) {
          const exists = anchor.shapeIds.some((id) => editor.getShape(id as TLShapeId) !== undefined);
          return { annotation, number, place: { kind: exists ? "elsewhere" : "orphaned" } };
        }
        const rect = onScreen(editor, page);
        // Comments on the same shapes line up leftwards instead of stacking.
        const key = `${Math.round(rect.maxX)}:${Math.round(rect.minY)}`;
        const slot = taken.get(key) ?? 0;
        taken.set(key, slot + 1);
        const badge = { x: rect.maxX - slot * (BADGE_SIZE + 4), y: rect.minY };
        return { annotation, number, place: { kind: "placed", rect, badge } };
      });
    },
    [editor, annotations],
  );
}

// ── The layer in front of the canvas ─────────────────────────────────────────

/** Keeps tldraw from taking pointer events meant for our controls. */
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

function AnnotationLayer() {
  const state = useContext(CanvasAnnotationsContext);
  const editor = useEditor();
  const markers = useMarkers(editor, state?.ready ? state.annotations : null);
  const viewport = useValue("viewport size", () => editor.getViewportScreenBounds(), [editor]);
  const target = useValue(
    "comment target",
    () => {
      if (!editor.isIn("select.idle")) return null;
      const ids = editor.getSelectedShapeIds();
      const bounds = editor.getSelectionPageBounds();
      if (ids.length === 0 || bounds === null) return null;
      const rect = onScreen(editor, bounds);
      return { ids, x: rect.midX, y: rect.maxY + 12 };
    },
    [editor],
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const card = useRef<HTMLDivElement | null>(null);

  const popover = state?.popover ?? null;
  const setPopover = state?.setPopover;
  const draftShapes = popover?.kind === "new" ? popover.shapeIds : null;
  const draftRect = useValue(
    "comment draft bounds",
    () => {
      const page = draftShapes === null ? null : boundsOf(editor, draftShapes);
      return page === null ? null : onScreen(editor, page);
    },
    [editor, draftShapes],
  );

  const belowItem = useCallback(
    (element: Element): Point => {
      const box = element.getBoundingClientRect();
      return { x: box.left - viewport.x + POPOVER_WIDTH / 2, y: box.bottom - viewport.y + 4 };
    },
    [viewport],
  );

  // The Review tab asked to show one: bring its shapes into view and open it.
  const focusId = useAnnotationFocus(state?.projectId ?? "", state?.path ?? "");
  useEffect(() => {
    if (focusId === null || state === null || !state.ready || state.annotations === null) return;
    const marker = markers.find((each) => each.annotation.id === focusId);
    if (marker === undefined) return;
    const anchor = marker.annotation.anchor;
    const page = anchor.kind === "shapes" ? boundsOf(editor, anchor.shapeIds) : null;
    if (page !== null) {
      editor.centerOnPoint(page.center, { animation: { duration: 200 } });
      state.setPopover({ kind: "open", id: focusId });
    } else {
      const item = listRef.current?.querySelector(`[data-annotation-id="${CSS.escape(focusId)}"]`);
      state.setPopover({ kind: "open", id: focusId, ...(item ? { at: belowItem(item) } : {}) });
    }
    takeAnnotationFocus(focusId);
  }, [focusId, state, markers, editor, belowItem]);

  // An open comment closes on a click elsewhere; a draft only on Cancel/Esc.
  useEffect(() => {
    if (popover?.kind !== "open" || setPopover === undefined) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (card.current?.contains(target) || target?.closest("[data-annotation-badge]")) return;
      setPopover(null);
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
  }, [popover?.kind, setPopover]);

  const openMarker = popover?.kind === "open" ? markers.find((each) => each.annotation.id === popover.id) : undefined;
  useEffect(() => {
    // Deleted meanwhile (here or elsewhere).
    if (popover?.kind === "open" && state?.annotations != null && openMarker === undefined) setPopover?.(null);
  }, [popover, state?.annotations, openMarker, setPopover]);

  if (state === null || setPopover === undefined) return null;

  const unplaced = markers.filter(
    (each) => each.place.kind === "orphaned" || each.place.kind === "canvas",
  );
  // Where the popover sits: under the new comment's shapes, the badge, or the list item.
  let popoverAt: Point | null = null;
  let outline: Box | null = null;
  if (popover?.kind === "new") {
    if (draftRect !== null) {
      outline = draftRect;
      popoverAt = { x: outline.midX, y: outline.maxY + 12 };
    } else {
      popoverAt = { x: viewport.w / 2, y: viewport.h / 3 };
    }
  } else if (popover?.kind === "open" && openMarker !== undefined) {
    if (openMarker.place.kind === "placed") {
      outline = openMarker.place.rect;
      popoverAt = { x: openMarker.place.badge.x, y: openMarker.place.badge.y + BADGE_SIZE / 2 + 8 };
    } else {
      popoverAt = popover.at ?? { x: 8 + POPOVER_WIDTH / 2, y: 56 };
    }
  }
  const place = (at: Point, width: number) => ({
    top: Math.max(4, Math.min(at.y, viewport.h - 120)),
    left: Math.max(4, Math.min(at.x - width / 2, viewport.w - width - 4)),
  });

  return (
    <>
      {outline !== null ? (
        <div
          className="pointer-events-none absolute rounded-sm border-2 border-dashed border-amber-400/80"
          style={{ left: outline.minX - 6, top: outline.minY - 6, width: outline.w + 12, height: outline.h + 12 }}
        />
      ) : null}

      {markers.map(({ annotation, number, place: where }) =>
        where.kind === "placed" ? (
          <button
            key={annotation.id}
            type="button"
            data-annotation-badge=""
            data-annotation-id={annotation.id}
            data-testid="canvas-annotation-badge"
            aria-label={`Comment ${number}`}
            title={annotation.comment}
            onPointerDown={stop}
            onClick={() =>
              setPopover(popover?.kind === "open" && popover.id === annotation.id ? null : { kind: "open", id: annotation.id })
            }
            className={cn(
              "pointer-events-auto absolute flex items-center justify-center rounded-full text-[11px] font-semibold shadow-md ring-2 ring-background transition-transform hover:scale-110",
              annotation.status === "resolved"
                ? "bg-muted text-muted-foreground"
                : annotation.status === "sent"
                  ? "bg-sky-500 text-white"
                  : "bg-amber-400 text-black",
              popover?.kind === "open" && popover.id === annotation.id && "scale-110 ring-amber-200",
            )}
            style={{
              width: BADGE_SIZE,
              height: BADGE_SIZE,
              left: where.badge.x - BADGE_SIZE / 2,
              top: where.badge.y - BADGE_SIZE / 2,
            }}
          >
            {number}
          </button>
        ) : null,
      )}

      {unplaced.length > 0 ? (
        <div
          ref={listRef}
          onPointerDown={stop}
          className="pointer-events-auto absolute left-2 top-14 flex max-h-[40%] w-64 flex-col gap-2 overflow-y-auto rounded-lg border border-dashed border-border bg-card/95 px-3 py-2 text-xs text-card-foreground shadow-sm"
        >
          <UnplacedGroup
            title="Comments on the whole canvas"
            testId="page-annotations"
            markers={unplaced.filter((each) => each.place.kind === "canvas")}
            onOpen={(id, element) => setPopover({ kind: "open", id, at: belowItem(element) })}
          />
          <UnplacedGroup
            title={(count) => (count === 1 ? "1 comment whose shapes are gone" : `${count} comments whose shapes are gone`)}
            testId="orphaned-annotations"
            markers={unplaced.filter((each) => each.place.kind === "orphaned")}
            onOpen={(id, element) => setPopover({ kind: "open", id, at: belowItem(element) })}
          />
        </div>
      ) : null}

      {target !== null && popover === null ? (
        <Button
          size="sm"
          variant="outline"
          onPointerDown={stop}
          className="pointer-events-auto absolute h-7 bg-popover px-2 shadow-md"
          style={place({ x: target.x, y: target.y }, 90)}
          onClick={() => setPopover({ kind: "new", shapeIds: target.ids })}
        >
          Comment
        </Button>
      ) : null}

      {popover !== null && popoverAt !== null && (popover.kind === "new" || openMarker !== undefined) ? (
        <EditorPortal>
          <div
            ref={card}
            role="dialog"
            aria-label={popover.kind === "new" ? "New comment" : "Comment"}
            onPointerDown={stop}
            className="absolute rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
            style={{ ...place(popoverAt, POPOVER_WIDTH), width: POPOVER_WIDTH, zIndex: POPOVER_Z }}
          >
            {popover.kind === "new" ? (
              <>
                <div className="mb-2 text-xs text-muted-foreground">
                  On {popover.shapeIds.length === 1 ? "1 shape" : `${popover.shapeIds.length} shapes`}
                </div>
                <CommentEditor
                  submitLabel="Save"
                  onCancel={() => setPopover(null)}
                  onSubmit={async (comment) => {
                    await state.rpc.call("annotations_create", {
                      projectId: state.projectId,
                      path: state.path,
                      anchor: { kind: "shapes", shapeIds: popover.shapeIds },
                      comment,
                    });
                    editor.selectNone();
                    setPopover(null);
                    state.refetch();
                  }}
                />
              </>
            ) : (
              <CommentCard
                key={openMarker!.annotation.id}
                annotation={openMarker!.annotation}
                rpc={state.rpc}
                projectId={state.projectId}
                onChanged={state.refetch}
                onClose={() => setPopover(null)}
              />
            )}
          </div>
        </EditorPortal>
      ) : null}
    </>
  );
}

function UnplacedGroup({
  title,
  testId,
  markers,
  onOpen,
}: {
  title: string | ((count: number) => string);
  testId: string;
  markers: Marker[];
  onOpen: (id: string, element: HTMLElement) => void;
}) {
  if (markers.length === 0) return null;
  return (
    <div data-testid={testId}>
      <div className="mb-1 font-medium text-muted-foreground">
        {typeof title === "string" ? title : title(markers.length)}
      </div>
      <ul className="flex flex-col gap-1">
        {markers.map(({ annotation, number }) => (
          <li key={annotation.id}>
            <button
              type="button"
              data-annotation-id={annotation.id}
              onClick={(event) => onOpen(annotation.id, event.currentTarget)}
              className={cn(
                "flex w-full items-baseline gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-state-hover",
                annotation.status === "resolved" && "text-muted-foreground",
              )}
            >
              <span className="shrink-0 tabular-nums text-muted-foreground">{number}.</span>
              <span className="truncate">{annotation.comment}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Context menu ─────────────────────────────────────────────────────────────

/** tldraw's context menu with *Comment* on top while shapes are selected. */
function CommentContextMenu(props: TLUiContextMenuProps) {
  const state = useContext(CanvasAnnotationsContext);
  const editor = useEditor();
  const selected = useValue("has selection", () => editor.getSelectedShapeIds().length > 0, [editor]);
  return (
    <DefaultContextMenu {...props}>
      {state !== null && selected ? (
        <TldrawUiMenuGroup id="space-annotations">
          <TldrawUiMenuItem
            id="space-comment"
            label="Comment"
            readonlyOk
            onSelect={() => state.setPopover({ kind: "new", shapeIds: editor.getSelectedShapeIds() })}
          />
        </TldrawUiMenuGroup>
      ) : null}
      <DefaultContextMenuContent />
    </DefaultContextMenu>
  );
}
