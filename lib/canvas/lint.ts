// Ported from bb-plugin-canvas (MIT, (c) 2026 Borja Marquez de la Plata):
// https://github.com/Borjampm/bb-plugin-canvas
//
// Overlap lint for `.tldr` files: after an agent draws, tell it which shapes
// sit on top of each other so it can fix its own diagram. Works on the raw
// records with rough metrics, no tldraw import: this runs on the server.
import { estimateTextSize } from "./layout";
import { plainText, tldrRecords } from "./read";

type Rec = Record<string, unknown>;

export type Bounds = { x: number; y: number; w: number; h: number };

export type LintIssue =
  | { kind: "overlap"; a: string; b: string; w: number; h: number }
  | { kind: "overflow"; shape: string; by: number; w: number; h: number };

/** Overlaps up to this many pixels on either axis are touching, not overlapping. */
const TOLERANCE = 4;
/** tldraw grows a box a little for most labels; only report a clear miss. */
const OVERFLOW_MIN = 24;
const OVERFLOW_RATIO = 0.25;
const NOTE_SIZE = 200;

function num(n: unknown, fallback = 0): number {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

const textSizes = new Set(["s", "m", "l", "xl"]);

/** Unrotated size of a geo, note or text shape, or null for other shapes. */
function shapeSize(shape: Rec): { w: number; h: number } | null {
  const props = (shape.props ?? {}) as Rec;
  const scale = num(props.scale, 1) || 1;
  if (shape.type === "geo") {
    return { w: num(props.w), h: num(props.h) + num(props.growY) };
  }
  if (shape.type === "note") {
    return { w: NOTE_SIZE * scale, h: (NOTE_SIZE + num(props.growY)) * scale };
  }
  if (shape.type === "text") {
    const size = textSizes.has(String(props.size)) ? (props.size as "s" | "m" | "l" | "xl") : "m";
    const est = estimateTextSize({ text: plainText(props.richText ?? props.text), size });
    // An auto-sized text's stored `w` is stale; a fixed-width one wraps at `w`.
    const w = props.autoSize === false && num(props.w) > 0 ? num(props.w) : est.w;
    return { w: w * scale, h: est.h * scale };
  }
  return null;
}

type Transform = { x: number; y: number; rotation: number };

function apply(t: Transform, x: number, y: number): { x: number; y: number } {
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return { x: t.x + x * cos - y * sin, y: t.y + x * sin + y * cos };
}

/**
 * Page-space bounds (axis-aligned, rotation included) of every geo, note and
 * text shape, keyed by shape id. Shapes inside groups or frames are moved by
 * their parents' transforms.
 */
export function shapeBounds(records: Rec[]): Map<string, Bounds> {
  const shapes = new Map<string, Rec>();
  for (const rec of records) {
    if (rec && typeof rec === "object" && rec.typeName === "shape") shapes.set(String(rec.id ?? ""), rec);
  }

  const transforms = new Map<string, Transform>();
  function pageTransform(id: string, depth = 0): Transform {
    const cached = transforms.get(id);
    if (cached) return cached;
    const shape = shapes.get(id);
    const local = { x: num(shape?.x), y: num(shape?.y), rotation: num(shape?.rotation) };
    const parentId = String(shape?.parentId ?? "");
    let result = local;
    if (shapes.has(parentId) && depth < 32) {
      const parent = pageTransform(parentId, depth + 1);
      const origin = apply(parent, local.x, local.y);
      result = { ...origin, rotation: parent.rotation + local.rotation };
    }
    transforms.set(id, result);
    return result;
  }

  const bounds = new Map<string, Bounds>();
  for (const [id, shape] of shapes) {
    const size = shapeSize(shape);
    if (!size || size.w <= 0 || size.h <= 0) continue;
    const t = pageTransform(id);
    const corners = [
      apply(t, 0, 0),
      apply(t, size.w, 0),
      apply(t, 0, size.h),
      apply(t, size.w, size.h),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    bounds.set(id, { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
  }
  return bounds;
}

/** How a shape is named in lint output: its spec id, else its label, else its record id. */
function nameOf(shape: Rec): string {
  const id = String(shape.id ?? "");
  const match = /^shape:(?:node|text)-(.+)$/.exec(id);
  if (match) return `"${match[1]}"`;
  const props = (shape.props ?? {}) as Rec;
  const label = plainText(props.richText ?? props.text).trim();
  if (label) return `user-drawn "${label.length > 40 ? `${label.slice(0, 39)}…` : label}"`;
  return `user-drawn (${id})`;
}

/** Overlapping shape pairs and boxes whose label clearly did not fit. Arrows are ignored. */
export function lintRecords(records: Rec[]): LintIssue[] {
  const bounds = shapeBounds(records);
  const shapes = new Map<string, Rec>();
  for (const rec of records) {
    if (rec && typeof rec === "object" && rec.typeName === "shape") shapes.set(String(rec.id ?? ""), rec);
  }
  const issues: LintIssue[] = [];

  const entries = [...bounds.entries()];
  for (let i = 0; i < entries.length; i++) {
    const [idA, a] = entries[i];
    for (let j = i + 1; j < entries.length; j++) {
      const [idB, b] = entries[j];
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (w > TOLERANCE && h > TOLERANCE) {
        issues.push({
          kind: "overlap",
          a: nameOf(shapes.get(idA)!),
          b: nameOf(shapes.get(idB)!),
          w: Math.round(w),
          h: Math.round(h),
        });
      }
    }
  }

  for (const shape of shapes.values()) {
    if (shape.type !== "geo") continue;
    const props = (shape.props ?? {}) as Rec;
    const h = num(props.h);
    const growY = num(props.growY);
    if (growY > OVERFLOW_MIN && growY > h * OVERFLOW_RATIO) {
      issues.push({
        kind: "overflow",
        shape: nameOf(shape),
        by: Math.round(growY),
        w: Math.round(num(props.w)),
        h: Math.round(h),
      });
    }
  }
  return issues;
}

/** Lint a `.tldr` file's text; an empty or unreadable file has no issues. */
export function lintTldr(json: string): LintIssue[] {
  const records = tldrRecords(json);
  return records ? lintRecords(records) : [];
}

/** One line per issue, as listed in the *Overlaps* section. */
export function formatIssue(issue: LintIssue): string {
  return issue.kind === "overlap"
    ? `- ${issue.a} and ${issue.b} overlap by ${issue.w}x${issue.h} px`
    : `- ${issue.shape}: label does not fit its ${issue.w}x${issue.h} box; tldraw grew it ${issue.by} px taller`;
}

/** The hint the draw result ends with when the lint found something. */
export const LINT_HINT =
  "To fix: re-send the listed node ids with explicit x/y (and w/h for labels that do not fit), or redraw with clear: true.";
