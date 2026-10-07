// The bridge between an HTML page in *Annotate* mode and the space. The page
// runs in a sandbox without allow-same-origin, so the parent cannot touch its
// DOM; instead `bridgeScript` is injected at the top of the page's <head> and
// talks to the parent with postMessage only.
//
// `htmlBridge` is serialized with `Function.toString`, so it must stay
// self-contained: no imports, no outer variables, nothing a bundler would
// rewrite into a helper call. It runs in vitest as a plain function.
//
// Trust: every message to the parent carries a per-mount token that the page's
// own scripts cannot read (the bridge runs first and removes its <script>);
// selections are reported only on trusted user events. The parent still never
// writes anything on a message alone — see `parseBridgeMessage`.
import { z } from "zod";

export interface BridgeConfig {
  /** Random per mount; the parent drops messages without it. */
  token: string;
  /** Characters of context on each side of a quote (`QUOTE_CONTEXT`). */
  context: number;
  /** Longest quote reported (`MAX_COMMENT_LENGTH`). */
  maxQuote: number;
  /** `::highlight()` names by state. */
  names: { open: string; resolved: string; active: string };
}

export interface BridgeRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Bridge → parent. Rects are in the frame's viewport. */
export type BridgeMessage =
  | { type: "text"; text: string }
  | { type: "selection"; exact: string; prefix: string; suffix: string; rect: BridgeRect }
  | { type: "unselect" }
  | { type: "click"; id: string; rect: BridgeRect };

export type HighlightState = "open" | "resolved" | "active";

/** Parent → bridge. Offsets are into the last `text` the bridge sent. */
export type ParentMessage =
  | { type: "highlight"; annotations: { id: string; start: number; end: number; state: HighlightState }[] }
  | { type: "reveal"; id: string }
  | { type: "unselect" };

/** Marks the messages on both sides, so unrelated postMessage traffic is ignored. */
export const BRIDGE_CHANNEL = "project-space-annotate";

const finite = z.number().finite();
const rect = z.object({ top: finite, left: finite, bottom: finite, right: finite });
const ID = z.string().regex(/^ann_[a-z0-9]{1,64}$/);

const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(5_000_000) }),
  z.object({
    type: z.literal("selection"),
    exact: z.string().min(1).max(4000),
    prefix: z.string().max(256),
    suffix: z.string().max(256),
    rect,
  }),
  z.object({ type: z.literal("unselect") }),
  z.object({ type: z.literal("click"), id: ID, rect }),
]);

/**
 * The message `data` as a `BridgeMessage` when it is on our channel, carries
 * this mount's token and matches the schema; null otherwise. The caller also
 * checks `event.source` is the frame's window.
 */
export function parseBridgeMessage(data: unknown, token: string): BridgeMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const envelope = data as { channel?: unknown; token?: unknown; message?: unknown };
  if (envelope.channel !== BRIDGE_CHANNEL || envelope.token !== token) return null;
  const parsed = messageSchema.safeParse(envelope.message);
  return parsed.success ? (parsed.data as BridgeMessage) : null;
}

/** Wraps a parent → bridge message for `postMessage`. */
export function toBridge(message: ParentMessage) {
  return { channel: BRIDGE_CHANNEL, message };
}

/** The <script> that runs the bridge with `config`. */
export function bridgeScript(config: BridgeConfig): string {
  // `<` escaped so a value can never close the script element.
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return `<script>(${htmlBridge.toString()})(${json}, ${JSON.stringify(BRIDGE_CHANNEL)});</script>`;
}

/**
 * Puts `<base href>` (unless the page has its own) and `extra` at the top of
 * the document's <head>, so an injected script runs before the page's own.
 */
export function injectIntoHead(html: string, base: string, extra = ""): string {
  const baseTag = /<base\s/i.test(html) ? "" : `<base href="${base.replace(/"/g, "&quot;")}">`;
  const inject = baseTag + extra;
  const head = /<head(\s[^>]*)?>/i;
  if (head.test(html)) return html.replace(head, (match) => match + inject);
  // No <head>: after the doctype and <html>, so the page keeps standards mode.
  const opening = /^(\s*<!doctype[^>]*>)?(\s*<html(\s[^>]*)?>)?/i;
  return html.replace(opening, (match) => match + inject);
}

/** Runs inside the frame. Self-contained: see the file comment. */
export function htmlBridge(config: BridgeConfig, channel: string): void {
  const host = window.parent;
  const doc = document;
  const script = doc.currentScript;
  if (script !== null) script.remove();
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/;

  const post = (message: unknown) => {
    host.postMessage({ channel, token: config.token, message }, "*");
  };

  interface Model {
    text: string;
    nodes: { node: Text; start: number }[];
  }

  const model = (): Model => {
    const root = doc.body ?? doc.documentElement;
    const nodes: Model["nodes"] = [];
    let text = "";
    if (root === null) return { text, nodes };
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        for (let parent = node.parentElement; parent !== null && parent !== root; parent = parent.parentElement) {
          if (SKIP.test(parent.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      nodes.push({ node: node as Text, start: text.length });
      text += (node as Text).data;
    }
    return { text, nodes };
  };

  const offsetOf = (current: Model, container: Node, offset: number): number => {
    for (const entry of current.nodes) {
      if (entry.node === container) return entry.start + Math.min(offset, entry.node.length);
    }
    const point = doc.createRange();
    point.setStart(container, offset);
    for (const entry of current.nodes) {
      if (point.comparePoint(entry.node, 0) >= 0) return entry.start;
    }
    return current.text.length;
  };

  const rangeOf = (current: Model, start: number, end: number): Range | null => {
    let from: Model["nodes"][number] | undefined;
    let to: Model["nodes"][number] | undefined;
    for (const entry of current.nodes) {
      if (from === undefined && entry.start + entry.node.length > start) from = entry;
      if (to === undefined && entry.start + entry.node.length >= end) to = entry;
    }
    if (from === undefined || to === undefined) return null;
    // A snapshot's node may have shrunk since; clamp instead of throwing.
    const range = doc.createRange();
    range.setStart(from.node, Math.min(start - from.start, from.node.length));
    range.setEnd(to.node, Math.min(end - to.start, to.node.length));
    return range;
  };

  const rectOf = (range: Range) => {
    const rects = range.getClientRects();
    const box = rects.length > 0 ? rects[rects.length - 1]! : range.getBoundingClientRect();
    return { top: box.top, left: box.left, bottom: box.bottom, right: box.right };
  };

  // ── Text ─────────────────────────────────────────────────────────────────
  // The parent's highlight offsets are into the text last sent, so painting
  // maps them through the model that text came from, not the live DOM.
  let sent: Model | null = null;
  let textTimer = 0;
  const sendText = () => {
    const current = model();
    if (current.text === sent?.text) {
      const moved = current.nodes.some((entry, index) => entry.node !== sent!.nodes[index]?.node);
      sent = current;
      if (moved) paint(lastPainted);
      return;
    }
    sent = current;
    post({ type: "text", text: current.text });
  };
  // Throttled, not debounced: a page that changes more often than the delay
  // (a ticking clock) must still send its text.
  const scheduleText = () => {
    if (textTimer !== 0) return;
    textTimer = window.setTimeout(() => {
      textTimer = 0;
      sendText();
    }, 150);
  };

  // ── Selection ────────────────────────────────────────────────────────────
  /** True while a selection reported on a trusted event is on screen. */
  let reported = false;
  const report = () => {
    const selection = doc.getSelection();
    const range = selection !== null && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
    const current = range === null ? null : model();
    let start = 0;
    let end = 0;
    if (range !== null && current !== null) {
      start = offsetOf(current, range.startContainer, range.startOffset);
      end = offsetOf(current, range.endContainer, range.endOffset);
      while (start < end && /\s/.test(current.text[start]!)) start++;
      while (end > start && /\s/.test(current.text[end - 1]!)) end--;
      end = Math.min(end, start + config.maxQuote);
    }
    if (range === null || current === null || start >= end) {
      if (reported) post({ type: "unselect" });
      reported = false;
      return;
    }
    reported = true;
    post({
      type: "selection",
      exact: current.text.slice(start, end),
      prefix: current.text.slice(Math.max(0, start - config.context), start),
      suffix: current.text.slice(end, end + config.context),
      rect: rectOf(range),
    });
  };
  // Only real user input reports a selection; a page script can select text
  // and dispatch events, but those events are not trusted.
  const onInput = (event: Event) => {
    if (event.isTrusted) report();
  };
  doc.addEventListener("mouseup", onInput, true);
  doc.addEventListener("keyup", onInput, true);
  window.addEventListener(
    "scroll",
    () => {
      if (reported) report();
    },
    true,
  );

  // ── Highlights ───────────────────────────────────────────────────────────
  const highlights = typeof CSS !== "undefined" && "highlights" in CSS ? (CSS.highlights as unknown as Map<string, unknown>) : null;
  if (highlights !== null) {
    const style = doc.createElement("style");
    style.textContent =
      `::highlight(${config.names.open}){background-color:rgb(250 204 21 / .35)}` +
      `::highlight(${config.names.active}){background-color:rgb(250 204 21 / .7)}` +
      `::highlight(${config.names.resolved}){text-decoration:underline dotted rgb(202 138 4);text-decoration-thickness:2px}`;
    (doc.head ?? doc.documentElement).append(style);
  }
  type Painted = { id: string; start: number; end: number; state: string };
  let lastPainted: Painted[] = [];
  let painted: { id: string; range: Range; length: number }[] = [];
  function paint(annotations: Painted[]) {
    lastPainted = annotations;
    const current = sent ?? model();
    painted = [];
    const groups: Record<string, Range[]> = { open: [], resolved: [], active: [] };
    for (const each of annotations) {
      const range = rangeOf(current, each.start, each.end);
      if (range === null || groups[each.state] === undefined) continue;
      groups[each.state]!.push(range);
      painted.push({ id: each.id, range, length: each.end - each.start });
    }
    if (highlights === null) return;
    for (const state of ["open", "resolved", "active"] as const) {
      const highlight = new Highlight(...groups[state]!);
      if (state === "active") highlight.priority = 1;
      highlights.set(config.names[state], highlight);
    }
  }

  // A click on a highlight asks the parent to open its comment. Like a
  // selection, only a real click counts: a page could dispatch one to open a
  // comment where it likes.
  doc.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target !== null && target.closest("a, button, input, select, textarea, label, summary")) return;
      if (doc.getSelection()?.isCollapsed === false) return;
      let best: { id: string; range: Range; length: number } | null = null;
      for (const each of painted) {
        const over = Array.from(each.range.getClientRects()).some(
          (box) => event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom,
        );
        if (over && (best === null || each.length < best.length)) best = each;
      }
      if (best !== null) {
        const box = { top: event.clientY, left: event.clientX, bottom: event.clientY, right: event.clientX };
        post({ type: "click", id: best.id, rect: box });
      }
    },
    true,
  );

  // ── From the parent ──────────────────────────────────────────────────────
  window.addEventListener("message", (event) => {
    if (event.source !== host) return;
    const data = event.data as { channel?: unknown; message?: { type?: unknown; annotations?: unknown; id?: unknown } } | null;
    if (data === null || typeof data !== "object" || data.channel !== channel || typeof data.message !== "object") return;
    const message = data.message;
    if (message === null) return;
    if (message.type === "highlight" && Array.isArray(message.annotations)) {
      paint(message.annotations as Painted[]);
    } else if (message.type === "reveal") {
      const found = painted.find((each) => each.id === message.id);
      if (found === undefined) return;
      const element = found.range.startContainer.parentElement;
      if (element !== null) element.scrollIntoView({ block: "center" });
      const box = found.range.getBoundingClientRect();
      const x = box.left + box.width / 2;
      post({ type: "click", id: found.id, rect: { top: box.bottom, left: x, bottom: box.bottom, right: x } });
    } else if (message.type === "unselect") {
      reported = false;
      doc.getSelection()?.removeAllRanges();
    }
  });

  const start = () => {
    sendText();
    new MutationObserver(scheduleText).observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  };
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
  else start();
}
