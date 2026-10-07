// Annotations as text for agents: the `bb space annotations` output and the
// `space_annotations` tool's. Pure, so the CLI and the tool print the same
// thing and tests need no server. Every result stays under `MAX_OUTPUT_BYTES`.
import { locateQuote, type Annotation, type AnnotationStatus } from "./annotations";
import { reviewGroups } from "./review";

/** Ceiling for one command's or tool call's output, in UTF-8 bytes. */
export const MAX_OUTPUT_BYTES = 60_000;
/** Lines of current file text shown on each side of a quote. */
export const CONTEXT_LINES = 3;

/** Longest quote or comment kept on a list line, in characters. */
const LIST_CLIP = 160;
/** Longest quote, comment or note `show` prints, in characters. */
const SHOW_CLIP = 4000;
/** Longest context line `show` prints, in characters. */
const LINE_CLIP = 400;

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export interface AnnotationFilter {
  path?: string;
  status?: AnnotationStatus;
}

/** The filtered annotations in the Review tab's order: by file, open first. */
export function filterAnnotations(
  annotations: readonly Annotation[],
  filter: AnnotationFilter,
): Annotation[] {
  const kept = annotations.filter(
    (each) =>
      (filter.path === undefined || each.path === filter.path) &&
      (filter.status === undefined || each.status === filter.status),
  );
  return reviewGroups(kept).flatMap((group) => group.annotations);
}

/** Where in its file an annotation points, in a few words. */
function placeOf(annotation: Annotation, max: number): string {
  const { anchor } = annotation;
  if (anchor.kind === "text-quote") return `«${clip(oneLine(anchor.exact), max)}»`;
  if (anchor.kind === "shapes") {
    return `${anchor.shapeIds.length === 1 ? "shape" : "shapes"} ${clip(anchor.shapeIds.join(", "), max)}`;
  }
  return "whole file";
}

/** One line per annotation: `id  status  path — place → comment`. */
export function listLine(annotation: Annotation): string {
  const comment = clip(oneLine(annotation.comment), LIST_CLIP);
  return `${annotation.id}  ${annotation.status.padEnd(8)}  ${annotation.path} — ${placeOf(annotation, LIST_CLIP)} → ${comment}`;
}

/** Lines that fit in the output budget, with a closing note on what was cut. */
export function listText(annotations: readonly Annotation[]): string {
  if (annotations.length === 0) return "No annotations.";
  const lines: string[] = [];
  let used = 0;
  for (const annotation of annotations) {
    const line = listLine(annotation);
    if (used + bytes(line) + 1 > MAX_OUTPUT_BYTES - 200) break;
    lines.push(line);
    used += bytes(line) + 1;
  }
  const left = annotations.length - lines.length;
  if (left > 0) {
    lines.push(`… ${left} more not shown; narrow with --path or --status.`);
  }
  return lines.join("\n");
}

export interface AnnotationListJson {
  annotations: Annotation[];
  total: number;
  /** True when annotations were left out to keep the output bounded. */
  truncated: boolean;
}

/** The list as JSON, as many whole annotations as fit in the budget. */
export function listJson(annotations: readonly Annotation[]): string {
  const kept: Annotation[] = [];
  let used = 200;
  for (const annotation of annotations) {
    const size = bytes(JSON.stringify(annotation)) + 1;
    if (used + size > MAX_OUTPUT_BYTES) break;
    kept.push(annotation);
    used += size;
  }
  const result: AnnotationListJson = {
    annotations: kept,
    total: annotations.length,
    truncated: kept.length < annotations.length,
  };
  return JSON.stringify(result);
}

export interface QuoteContext {
  /** 1-based line of the first context line. */
  firstLine: number;
  /** 1-based lines holding the quote itself. */
  quoteLines: [number, number];
  lines: string[];
}

/**
 * The quote's lines in the current text with `CONTEXT_LINES` either side,
 * found with `locateQuote`; null when the quote is gone.
 */
export function quoteContext(
  text: string,
  annotation: Annotation,
  around = CONTEXT_LINES,
): QuoteContext | null {
  if (annotation.anchor.kind !== "text-quote") return null;
  const range = locateQuote(text, annotation.anchor);
  if (range === null) return null;
  const all = text.split("\n");
  const lineAt = (offset: number) => text.slice(0, offset).split("\n").length;
  const startLine = lineAt(range.start);
  const endLine = lineAt(Math.max(range.start, range.end - 1));
  const from = Math.max(1, startLine - around);
  const to = Math.min(all.length, endLine + around);
  return {
    firstLine: from,
    quoteLines: [startLine, endLine],
    lines: all.slice(from - 1, to),
  };
}

/**
 * Everything an agent needs to act on one annotation: the comment, where it
 * points, and the passage as the file reads now. `text` is the file's current
 * content, null when it cannot be read.
 */
export function showText(annotation: Annotation, text: string | null): string {
  const out = [
    `${annotation.id} · ${annotation.status} · ${annotation.path}`,
    `by ${annotation.author}, ${new Date(annotation.createdAt).toISOString()}` +
      (annotation.sentTo ? ` · sent to ${annotation.sentTo.threadId}` : ""),
    "",
    "Comment:",
    indent(clip(annotation.comment.trim(), SHOW_CLIP)),
  ];
  if (annotation.resolution !== undefined && annotation.resolution !== "") {
    out.push("", annotation.status === "resolved" ? "Resolution:" : "Reply:");
    out.push(indent(clip(annotation.resolution.trim(), SHOW_CLIP)));
  }
  out.push("");

  const { anchor } = annotation;
  if (anchor.kind === "file") {
    out.push("Anchor: the whole file.");
  } else if (anchor.kind === "shapes") {
    out.push(
      `Anchor: ${anchor.shapeIds.length === 1 ? "shape" : "shapes"} ${clip(anchor.shapeIds.join(", "), SHOW_CLIP)}`,
      `Read the canvas with \`bb space canvas ${annotation.path}\` to see them.`,
    );
  } else {
    out.push("Quote:", indent(clip(anchor.exact, SHOW_CLIP)), "");
    const context = text === null ? null : quoteContext(text, annotation);
    if (text === null) {
      out.push(`${annotation.path} cannot be read; it may have been deleted.`);
    } else if (context === null) {
      out.push("The quote is no longer in the file (orphaned); the text around it changed too much.");
    } else {
      const [first, last] = context.quoteLines;
      out.push(first === last ? `Now at line ${first}:` : `Now at lines ${first}–${last}:`);
      const width = String(context.firstLine + context.lines.length - 1).length;
      context.lines.forEach((line, index) => {
        const number = context.firstLine + index;
        const mark = number >= first && number <= last ? ">" : " ";
        out.push(`${mark}${String(number).padStart(width)} | ${clip(line, LINE_CLIP)}`);
      });
    }
  }
  return out.join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
