// Ported from bb-plugin-canvas (MIT, (c) 2026 Borja Marquez de la Plata):
// https://github.com/Borjampm/bb-plugin-canvas
//
// Turns a `.tldr` file back into text an agent can read: the records are
// walked and described in the same vocabulary `space_draw` uses, so agents
// see the user's own edits and can build on them. No tldraw import: this runs
// on the server.

type Rec = Record<string, unknown>;

/** tldraw stores labels as a TipTap document; pull the plain text out. */
export function plainText(rich: unknown): string {
  if (typeof rich === "string") return rich;
  if (!rich || typeof rich !== "object") return "";
  const node = rich as Rec;
  if (typeof node.text === "string") return node.text;
  const content = node.content;
  if (!Array.isArray(content)) return "";
  const parts = content.map(plainText).filter((t) => t.length > 0);
  // Paragraph-level nodes become separate lines, inline runs stay joined.
  return node.type === "doc" ? parts.join(" / ") : parts.join("");
}

function round(n: unknown): number {
  return typeof n === "number" ? Math.round(n) : 0;
}

/** `shape:node-foo` -> `foo`, for ids the draw tool created. */
function specId(shapeId: string, kind: string): string | null {
  const prefix = `shape:${kind}-`;
  return shapeId.startsWith(prefix) ? shapeId.slice(prefix.length) : null;
}

/** The records of a `.tldr` file, or null when it is not one. */
export function tldrRecords(json: string): Rec[] | null {
  try {
    const parsed = JSON.parse(json) as Rec;
    return Array.isArray(parsed.records) ? (parsed.records as Rec[]) : null;
  } catch {
    return null;
  }
}

/** Spec node ids already drawn in a `.tldr` file. */
export function drawnNodeIds(json: string): Set<string> {
  const ids = new Set<string>();
  for (const rec of tldrRecords(json) ?? []) {
    if (rec.typeName !== "shape") continue;
    const id = specId(String(rec.id ?? ""), "node");
    if (id !== null) ids.add(id);
  }
  return ids;
}

export function describeTldr(json: string, title: string): string {
  if (json.trim() === "") return `${title} — an empty canvas; nothing is drawn yet.`;
  const rawRecords = tldrRecords(json);
  if (rawRecords === null) return `${title} — not a readable tldraw file.`;
  const records = rawRecords.filter(
    (r): r is Rec => !!r && typeof r === "object",
  );
  const shapes = records.filter((r) => r.typeName === "shape");

  // arrow shape id -> { start: bound shape id, end: bound shape id }
  const bindings = new Map<string, { start?: string; end?: string }>();
  for (const rec of records) {
    if (rec.typeName !== "binding" || rec.type !== "arrow") continue;
    const from = String(rec.fromId ?? "");
    const terminal = (rec.props as Rec | undefined)?.terminal;
    if (terminal !== "start" && terminal !== "end") continue;
    const entry = bindings.get(from) ?? {};
    entry[terminal] = String(rec.toId ?? "");
    bindings.set(from, entry);
  }

  const nodeLines: string[] = [];
  const arrowLines: string[] = [];
  const textLines: string[] = [];
  const otherCounts = new Map<string, number>();
  // shape id -> the label used in arrow descriptions
  const nameOf = new Map<string, string>();

  for (const shape of shapes) {
    const id = String(shape.id ?? "");
    const props = (shape.props ?? {}) as Rec;
    const label = plainText(props.richText ?? props.text);
    const mine = specId(id, "node");
    if (shape.type === "geo" || shape.type === "note") {
      nameOf.set(id, mine ?? (label || id));
    } else if (shape.type === "text") {
      nameOf.set(id, mine ?? (label || id));
    }
  }

  for (const shape of shapes) {
    const id = String(shape.id ?? "");
    const props = (shape.props ?? {}) as Rec;
    const label = plainText(props.richText ?? props.text);
    const at = `at (${round(shape.x)}, ${round(shape.y)})`;

    if (shape.type === "geo" || shape.type === "note") {
      const nodeId = specId(id, "node");
      const kind = shape.type === "note" ? "note" : String(props.geo ?? "rectangle");
      const size =
        shape.type === "note" ? "" : ` ${round(props.w)}x${round(props.h)}`;
      const color = props.color ? `, ${String(props.color)}` : "";
      const who = nodeId ? `id "${nodeId}"` : `user-drawn (${id})`;
      nodeLines.push(
        `- ${who} [${kind}${color}] ${label ? `"${label}"` : "(no label)"} ${at}${size}`,
      );
      continue;
    }

    if (shape.type === "arrow") {
      const bound = bindings.get(id);
      const start = bound?.start ? nameOf.get(bound.start) ?? bound.start : null;
      const end = bound?.end ? nameOf.get(bound.end) ?? bound.end : null;
      const edgeId = specId(id, "edge");
      const ends =
        start && end
          ? `${start} -> ${end}`
          : `unbound arrow ${at}${edgeId ? ` (id "${edgeId}")` : ""}`;
      arrowLines.push(`- ${ends}${label ? ` "${label}"` : ""}`);
      continue;
    }

    if (shape.type === "text") {
      const textId = specId(id, "text");
      textLines.push(
        `- ${textId ? `id "${textId}"` : "user-drawn"}: "${label}" ${at}`,
      );
      continue;
    }

    const type = String(shape.type ?? "unknown");
    otherCounts.set(type, (otherCounts.get(type) ?? 0) + 1);
  }

  const sections: string[] = [
    `${title} — ${shapes.length} shape(s) on the board.`,
  ];
  if (nodeLines.length > 0) sections.push("", "Nodes:", ...nodeLines);
  if (arrowLines.length > 0) sections.push("", "Arrows:", ...arrowLines);
  if (textLines.length > 0) sections.push("", "Text:", ...textLines);
  if (otherCounts.size > 0) {
    const summary = [...otherCounts.entries()]
      .map(([type, n]) => `${n} ${type}`)
      .join(", ");
    sections.push("", `Other shapes drawn by the user: ${summary}.`);
  }
  if (shapes.length === 0) {
    sections.push("", "The board is currently blank.");
  }
  return sections.join("\n");
}
