// The Review tab's pure core: how annotations are grouped for the tab, the
// message *Send to…* posts to a thread, and reading annotation ids back out
// of such a message (the server marks those as sent when it is dispatched).
import type { Annotation, AnnotationStatus } from "./annotations";

/** First words of every review message; ids are only read after it. */
export const REVIEW_HEADER = "Review of the project space";

/** Longest quote kept in a message line, in characters. */
const MAX_QUOTE = 160;
/** Shape ids listed for a canvas annotation before "…". */
const MAX_SHAPES = 5;

const STATUS_ORDER: Record<AnnotationStatus, number> = { open: 0, sent: 1, resolved: 2 };

export interface ReviewGroup {
  path: string;
  annotations: Annotation[];
  open: number;
}

/**
 * Annotations grouped by file. Inside a file: open, then sent, then resolved,
 * oldest first. Files with open comments come first, then by path.
 */
export function reviewGroups(annotations: readonly Annotation[]): ReviewGroup[] {
  const byPath = new Map<string, Annotation[]>();
  for (const each of annotations) {
    const list = byPath.get(each.path) ?? [];
    list.push(each);
    byPath.set(each.path, list);
  }
  return [...byPath]
    .map(([path, list]) => ({
      path,
      annotations: [...list].sort(
        (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.createdAt - b.createdAt,
      ),
      open: list.filter((each) => each.status === "open").length,
    }))
    .sort((a, b) => Number(a.open === 0) - Number(b.open === 0) || compare(a.path, b.path));
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Where in its file an annotation points, as message text; "" for the whole file. */
function placeOf(annotation: Annotation): string {
  const { anchor } = annotation;
  if (anchor.kind === "text-quote") return `«${clip(oneLine(anchor.exact), MAX_QUOTE)}»`;
  if (anchor.kind === "shapes") {
    const listed = anchor.shapeIds.slice(0, MAX_SHAPES).join(", ");
    const more = anchor.shapeIds.length > MAX_SHAPES ? ", …" : "";
    return `${anchor.shapeIds.length === 1 ? "shape" : "shapes"} ${listed}${more}`;
  }
  return "";
}

/**
 * The message sent to an agent: one numbered line per annotation, in the
 * Review tab's order, each ending with its id, and how to resolve them.
 * Comments keep their line breaks, indented under their number.
 */
export function reviewMessage(annotations: readonly Annotation[]): string {
  const ordered = reviewGroups(annotations).flatMap((group) => group.annotations);
  const count = ordered.length === 1 ? "1 comment" : `${ordered.length} comments`;
  const lines = ordered.map((annotation, index) => {
    const number = `${index + 1}. `;
    const place = placeOf(annotation);
    const comment = annotation.comment
      .trim()
      .split(/\r?\n/)
      .map((line, at) => (at === 0 ? line : `${" ".repeat(number.length)}${line}`))
      .join("\n");
    return `${number}${annotation.path}${place === "" ? "" : ` — ${place}`} → ${comment}  [${annotation.id}]`;
  });
  return [
    `${REVIEW_HEADER} — ${count}.`,
    ...lines,
    'Resolve each with `bb space annotations resolve <id> --note "…"` when done.',
  ].join("\n");
}

const ID_PATTERN = /\[(ann_[a-z0-9]{1,64})\]/g;

/** The annotation ids in a review message, in order; none unless it has the header. */
export function annotationIdsIn(text: string): string[] {
  const start = text.indexOf(REVIEW_HEADER);
  if (start === -1) return [];
  const ids = [...text.slice(start).matchAll(ID_PATTERN)].map((match) => match[1]!);
  return [...new Set(ids)];
}
