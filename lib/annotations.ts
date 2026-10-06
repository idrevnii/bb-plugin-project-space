// Annotations: comments pinned to a place in a space file. The model and the
// pure anchoring helpers, shared by the server and the app. No SDK or Node
// imports, so both bundles can use them.
//
// Storage and RPC live in server/annotations.ts; architecture/annotations.md
// in the space describes the whole contract.
import { SPACE_META_DIR } from "./space";

/** Where an annotation points inside its file. */
export type Anchor =
  /** A passage of text (Markdown, HTML, plain text), found again by quote. */
  | { kind: "text-quote"; exact: string; prefix: string; suffix: string }
  /** tldraw shapes, by id. */
  | { kind: "shapes"; shapeIds: string[] }
  /** The whole file. */
  | { kind: "file" };

export type AnnotationStatus = "open" | "sent" | "resolved";
export type AnnotationAuthor = "user" | "agent";

export interface Annotation {
  /** `ann_` + random. */
  id: string;
  /** Space-relative path of the annotated file. */
  path: string;
  anchor: Anchor;
  /** At most `MAX_COMMENT_LENGTH` characters. */
  comment: string;
  status: AnnotationStatus;
  author: AnnotationAuthor;
  createdAt: number;
  updatedAt: number;
  /** Set when the comment was sent to a thread. */
  sentTo?: { threadId: string; at: number };
  /** The agent's note when resolving. */
  resolution?: string;
}

/** On-disk shape of one annotation file. */
export interface AnnotationFile {
  version: 1;
  annotations: Annotation[];
}

export const MAX_COMMENT_LENGTH = 4000;
/** Characters of context kept on each side of a quote. */
export const QUOTE_CONTEXT = 32;

/** Realtime channel: payload `{ projectId, path }` after every write. */
export const SPACE_ANNOTATIONS_CHANGED = "space-annotations-changed";

/** Space-relative folder holding the annotation files. */
export const ANNOTATIONS_DIR = `${SPACE_META_DIR}/annotations`;

/** Space-relative path of the annotation file for a space file. */
export function annotationFilePath(path: string): string {
  return `${ANNOTATIONS_DIR}/${path}.json`;
}

/** True for paths inside the plugin's own bookkeeping folder. */
export function isMetaPath(path: string): boolean {
  return path === SPACE_META_DIR || path.startsWith(`${SPACE_META_DIR}/`);
}

export function newAnnotationId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let id = "ann_";
  for (const byte of bytes) id += (byte % 36).toString(36);
  return id;
}

// ── Text-quote anchoring ─────────────────────────────────────────────────────

export interface QuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface TextRange {
  start: number;
  end: number;
}

/** The selector for `text[start, end)`, with `QUOTE_CONTEXT` chars each side. */
export function quoteSelector(
  text: string,
  start: number,
  end: number,
): QuoteSelector {
  const from = Math.max(0, Math.min(start, end, text.length));
  const to = Math.min(text.length, Math.max(start, end, 0));
  return {
    exact: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - QUOTE_CONTEXT), from),
    suffix: text.slice(to, to + QUOTE_CONTEXT),
  };
}

/** Quotes shorter than this are only found exactly; fuzzy hits would be noise. */
const MIN_FUZZY_LENGTH = 8;
/** Largest edit distance accepted, as a share of the quote's length. */
const MAX_FUZZY_ERROR = 0.3;
/** Above this many DP cells the fuzzy search is skipped (it is O(n·m)). */
const MAX_FUZZY_CELLS = 50_000_000;

/**
 * Finds the selector's quote in `text`. An exact match wins; several exact
 * matches are told apart by how much of the prefix and suffix surround each.
 * Without an exact match, the closest approximate match within
 * `MAX_FUZZY_ERROR` is returned. Null means the quote is gone (orphaned).
 */
export function locateQuote(
  text: string,
  selector: QuoteSelector,
): TextRange | null {
  const { exact } = selector;
  if (exact === "") return null;

  const exactHits: TextRange[] = [];
  for (
    let index = text.indexOf(exact);
    index !== -1;
    index = text.indexOf(exact, index + 1)
  ) {
    exactHits.push({ start: index, end: index + exact.length });
  }
  if (exactHits.length === 1) return exactHits[0]!;
  if (exactHits.length > 1) return bestByContext(text, selector, exactHits);

  if (exact.length < MIN_FUZZY_LENGTH) return null;
  if (text.length * exact.length > MAX_FUZZY_CELLS) return null;
  const maxErrors = Math.floor(exact.length * MAX_FUZZY_ERROR);
  const hits = approximateMatches(text, exact, maxErrors);
  if (hits.length === 0) return null;
  return bestByContext(text, selector, hits);
}

function contextScore(
  text: string,
  selector: QuoteSelector,
  range: TextRange,
): number {
  const before = text.slice(
    Math.max(0, range.start - selector.prefix.length),
    range.start,
  );
  const after = text.slice(range.end, range.end + selector.suffix.length);
  let score = 0;
  // Characters of the prefix that end right before the match…
  for (
    let i = 1;
    i <= Math.min(before.length, selector.prefix.length) &&
    before[before.length - i] === selector.prefix[selector.prefix.length - i];
    i++
  ) {
    score++;
  }
  // …and of the suffix that start right after it.
  for (
    let i = 0;
    i < Math.min(after.length, selector.suffix.length) &&
    after[i] === selector.suffix[i];
    i++
  ) {
    score++;
  }
  return score;
}

function bestByContext(
  text: string,
  selector: QuoteSelector,
  candidates: (TextRange & { errors?: number })[],
): TextRange {
  let best = candidates[0]!;
  let bestKey = rank(best);
  for (const candidate of candidates.slice(1)) {
    const key = rank(candidate);
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
      best = candidate;
      bestKey = key;
    }
  }
  return { start: best.start, end: best.end };

  function rank(candidate: TextRange & { errors?: number }): [number, number] {
    // Fewer edits first, then more surrounding context.
    return [candidate.errors ?? 0, contextScore(text, selector, candidate)];
  }
}

/**
 * Every end position where `pattern` matches a substring of `text` with at
 * most `maxErrors` edits (Sellers' algorithm), each with the start of its
 * best alignment. Consecutive end positions are one occurrence, so each run
 * keeps only its closest fit.
 */
function approximateMatches(
  text: string,
  pattern: string,
  maxErrors: number,
): (TextRange & { errors: number })[] {
  const m = pattern.length;
  let prev = new Int32Array(m + 1);
  let prevStart = new Int32Array(m + 1);
  let cur = new Int32Array(m + 1);
  let curStart = new Int32Array(m + 1);
  for (let i = 0; i <= m; i++) {
    prev[i] = i;
    prevStart[i] = 0;
  }

  const ends: (TextRange & { errors: number })[] = [];
  let runEnd = -1;
  for (let j = 1; j <= text.length; j++) {
    cur[0] = 0;
    curStart[0] = j;
    const ch = text.charCodeAt(j - 1);
    for (let i = 1; i <= m; i++) {
      let value = prev[i - 1]! + (pattern.charCodeAt(i - 1) === ch ? 0 : 1);
      let start = prevStart[i - 1]!;
      if (cur[i - 1]! + 1 < value) {
        value = cur[i - 1]! + 1;
        start = curStart[i - 1]!;
      }
      if (prev[i]! + 1 < value) {
        value = prev[i]! + 1;
        start = prevStart[i]!;
      }
      cur[i] = value;
      curStart[i] = start;
    }
    if (cur[m]! <= maxErrors) {
      const hit = { start: curStart[m]!, end: j, errors: cur[m]! };
      const last = ends[ends.length - 1];
      if (last !== undefined && runEnd === j - 1) {
        // The same occurrence one character further: keep the closer fit.
        if (betterFit(hit, last, m)) ends[ends.length - 1] = hit;
      } else {
        ends.push(hit);
      }
      runEnd = j;
    }
    [prev, cur] = [cur, prev];
    [prevStart, curStart] = [curStart, prevStart];
  }
  return ends;
}

function betterFit(
  a: TextRange & { errors: number },
  b: TextRange & { errors: number },
  length: number,
): boolean {
  if (a.errors !== b.errors) return a.errors < b.errors;
  const lengthGap = (range: TextRange) =>
    Math.abs(range.end - range.start - length);
  return lengthGap(a) < lengthGap(b);
}
