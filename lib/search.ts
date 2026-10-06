// Pure matching for space search: case-insensitive substring hits in text
// files and in canvas labels, with short snippets around each hit. No SDK
// or Node imports; `server/search.ts` does the I/O.
import { plainText, tldrRecords } from "./canvas/read";
import { fileKind } from "./space";

export interface ContentHit {
  /** 1-based line, for text files; canvases have none. */
  line?: number;
  snippet: string;
}

/** Hits per file; the rest of a file's matches are not worth the space. */
export const HITS_PER_FILE = 3;

const SNIPPET_CHARS = 120;

/** True for files whose bytes search reads as text. */
export function isSearchablePath(path: string): boolean {
  const kind = fileKind(path);
  return kind === "markdown" || kind === "html" || kind === "text" || kind === "tldraw";
}

/** True when the first bytes hold a NUL, the usual sign of a binary file. */
export function looksBinary(text: string): boolean {
  return text.slice(0, 8192).includes("\0");
}

/**
 * Up to `SNIPPET_CHARS` of `line` around the hit at `index`, whitespace
 * collapsed, with an ellipsis where it was cut.
 */
export function snippetAround(line: string, index: number, length: number): string {
  const lead = Math.max(0, Math.floor((SNIPPET_CHARS - length) / 3));
  let start = Math.max(0, index - lead);
  const end = Math.min(line.length, start + SNIPPET_CHARS);
  start = Math.max(0, Math.min(start, end - SNIPPET_CHARS));
  const body = line.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < line.length ? "…" : ""}`;
}

/** Lines of `text` containing `query` (any case), at most `max`. */
export function matchText(text: string, query: string, max = HITS_PER_FILE): ContentHit[] {
  const needle = query.toLowerCase();
  if (needle === "") return [];
  const hits: ContentHit[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length && hits.length < max; i++) {
    const line = lines[i]!;
    const index = line.toLowerCase().indexOf(needle);
    if (index !== -1) hits.push({ line: i + 1, snippet: snippetAround(line, index, needle.length) });
  }
  return hits;
}

/** Shape labels of a `.tldr` file containing `query`, at most `max`. */
export function matchCanvas(json: string, query: string, max = HITS_PER_FILE): ContentHit[] {
  const needle = query.toLowerCase();
  if (needle === "") return [];
  const hits: ContentHit[] = [];
  for (const rec of tldrRecords(json) ?? []) {
    if (hits.length >= max) break;
    if (!rec || typeof rec !== "object" || rec.typeName !== "shape") continue;
    const props = (rec.props ?? {}) as Record<string, unknown>;
    const label = plainText(props.richText ?? props.text).trim();
    const index = label.toLowerCase().indexOf(needle);
    if (index !== -1) hits.push({ snippet: snippetAround(label, index, needle.length) });
  }
  return hits;
}

/** Content hits in a space file, by its kind. */
export function matchFile(path: string, content: string, query: string): ContentHit[] {
  return fileKind(path) === "tldraw" ? matchCanvas(content, query) : matchText(content, query);
}
