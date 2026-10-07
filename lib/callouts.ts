// Callouts: a blockquote whose first line is a `[!type]` marker, as in GitHub
// alerts (`> [!NOTE]`) and Obsidian callouts (`> [!info]- Custom title`).
// The reader and the editor both parse the marker line with this module.

/** The color family a callout type renders in. */
export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution" | "quote";

export interface CalloutMarker {
  /** The type as written, e.g. `NOTE` or `info`. */
  type: string;
  kind: CalloutKind;
  /** Obsidian's fold marker: `-` starts collapsed, `+` expanded, "" not foldable. */
  fold: "" | "+" | "-";
  /** The rest of the marker line as written (Markdown source), or "". */
  title: string;
}

// GitHub's five alert types keep GitHub's colors (so CAUTION is red);
// Obsidian's types join the nearest one. Unknown types read as notes.
const KINDS: Record<string, CalloutKind> = {
  note: "note",
  info: "note",
  todo: "note",
  abstract: "note",
  summary: "note",
  tldr: "note",
  tip: "tip",
  hint: "tip",
  success: "tip",
  check: "tip",
  done: "tip",
  important: "important",
  question: "important",
  help: "important",
  faq: "important",
  example: "important",
  warning: "warning",
  attention: "warning",
  caution: "caution",
  danger: "caution",
  error: "caution",
  failure: "caution",
  fail: "caution",
  missing: "caution",
  bug: "caution",
  quote: "quote",
  cite: "quote",
};

const MARKER = /^\[!([A-Za-z][\w-]*)\]([+-]?)(?:[ \t]+(.*?))?[ \t]*$/;

/** Parses the first line of a blockquote; null when it is not a marker. */
export function parseCalloutMarker(line: string): CalloutMarker | null {
  const match = MARKER.exec(line);
  if (match === null) return null;
  const type = match[1]!;
  return {
    type,
    kind: KINDS[type.toLowerCase()] ?? "note",
    fold: match[2] as CalloutMarker["fold"],
    title: match[3] ?? "",
  };
}

/** The title shown when the marker gives none: the type, capitalized. */
export function defaultCalloutTitle(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

/** The marker line for a callout, as written back into Markdown. */
export function formatCalloutMarker({ type, fold, title }: Pick<CalloutMarker, "type" | "fold" | "title">): string {
  return `[!${type}]${fold}${title === "" ? "" : ` ${title}`}`;
}
