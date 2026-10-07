// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRIDGE_CHANNEL,
  bridgeScript,
  htmlBridge,
  injectIntoHead,
  parseBridgeMessage,
  toBridge,
  type BridgeConfig,
} from "../ui/annotate/html-bridge";

const config: BridgeConfig = {
  token: "t0ken",
  context: 4,
  maxQuote: 4000,
  names: { open: "a-open", resolved: "a-resolved", active: "a-active" },
};

const envelope = (message: unknown, token = config.token) => ({ channel: BRIDGE_CHANNEL, token, message });

describe("parseBridgeMessage", () => {
  const rect = { top: 1, left: 2, bottom: 3, right: 4 };

  it("accepts each message on the channel with the token", () => {
    expect(parseBridgeMessage(envelope({ type: "text", text: "Hi" }), "t0ken")).toEqual({ type: "text", text: "Hi" });
    expect(parseBridgeMessage(envelope({ type: "unselect" }), "t0ken")).toEqual({ type: "unselect" });
    const selection = { type: "selection", exact: "quick", prefix: "The ", suffix: " fox", rect };
    expect(parseBridgeMessage(envelope(selection), "t0ken")).toEqual(selection);
    expect(parseBridgeMessage(envelope({ type: "click", id: "ann_abc123", rect }), "t0ken")).toMatchObject({ id: "ann_abc123" });
  });

  it("drops a wrong token, another channel and junk", () => {
    expect(parseBridgeMessage(envelope({ type: "unselect" }, "guess"), "t0ken")).toBeNull();
    expect(parseBridgeMessage({ channel: "other", token: "t0ken", message: { type: "unselect" } }, "t0ken")).toBeNull();
    expect(parseBridgeMessage(null, "t0ken")).toBeNull();
    expect(parseBridgeMessage("unselect", "t0ken")).toBeNull();
  });

  it("drops messages that do not match the schema", () => {
    const bad = [
      { type: "selection", exact: "", prefix: "", suffix: "", rect },
      { type: "selection", exact: "x".repeat(4001), prefix: "", suffix: "", rect },
      { type: "selection", exact: "x", prefix: "", suffix: "", rect: { ...rect, top: Number.NaN } },
      { type: "click", id: "../etc", rect },
      { type: "create", comment: "hi" },
    ];
    for (const message of bad) expect(parseBridgeMessage(envelope(message), "t0ken")).toBeNull();
  });
});

describe("injectIntoHead", () => {
  it("puts the base and the extra right after <head>", () => {
    const html = '<!doctype html><html><head><title>x</title><script src="a.js"></script></head></html>';
    expect(injectIntoHead(html, "http://h/space/", "<script>1</script>")).toBe(
      '<!doctype html><html><head><base href="http://h/space/"><script>1</script><title>x</title><script src="a.js"></script></head></html>',
    );
  });

  it("keeps the page's own <base>", () => {
    expect(injectIntoHead('<head><base href="/x/"></head>', "http://h/", "!")).toBe('<head>!<base href="/x/"></head>');
  });

  it("goes after the doctype and <html> when there is no <head>", () => {
    expect(injectIntoHead("<!DOCTYPE html>\n<html lang=en><p>Hi", "http://h/", "!")).toBe(
      '<!DOCTYPE html>\n<html lang=en><base href="http://h/">!<p>Hi',
    );
    expect(injectIntoHead("<p>Hi", "http://h/")).toBe('<base href="http://h/"><p>Hi');
  });
});

describe("bridgeScript", () => {
  it("cannot be closed early by a config value", () => {
    const script = bridgeScript({ ...config, token: "</script><script>alert(1)" });
    expect(script.match(/<\/script>/g)).toHaveLength(1);
  });

  it("is self-contained: the serialized function runs on its own", () => {
    const body = bridgeScript(config).replace(/^<script>|<\/script>$/g, "");
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    document.body.innerHTML = "<p>Standalone</p>";
    new Function(body)();
    expect(post).toHaveBeenCalledWith(envelope({ type: "text", text: "Standalone" }), "*");
    post.mockRestore();
  });
});

describe("htmlBridge", () => {
  let posted: unknown[];
  let post: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    posted = [];
    // In happy-dom the top window is its own parent.
    post = vi.spyOn(window, "postMessage").mockImplementation((data: unknown) => {
      posted.push((data as { message: unknown }).message);
    });
    document.body.innerHTML = "<h1>Status</h1><script>var x = 1;</script><style>p{}</style><p>The quick brown fox</p>";
    htmlBridge(config, BRIDGE_CHANNEL);
  });

  afterEach(() => post.mockRestore());

  const fromParent = (message: unknown, source: Window | null = window) =>
    window.dispatchEvent(new MessageEvent("message", { data: toBridge(message as never), source }));

  it("sends the rendered text without script and style", () => {
    expect(posted[0]).toEqual({ type: "text", text: "StatusThe quick brown fox" });
  });

  it("ignores a mouseup a page script dispatches over its own selection", () => {
    const text = document.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 9);
    document.getSelection()!.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    expect(posted.filter((each) => (each as { type: string }).type === "selection")).toEqual([]);
  });

  it("paints what the parent sends and reveals it as a click", () => {
    fromParent({ type: "highlight", annotations: [{ id: "ann_1", start: 10, end: 15, state: "open" }] });
    fromParent({ type: "reveal", id: "ann_1" });
    expect(posted.at(-1)).toMatchObject({ type: "click", id: "ann_1" });
  });

  it("ignores a click a page script dispatches over a highlight", () => {
    // happy-dom lays nothing out, so give every range a box under the click.
    const rects = vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([{ top: 0, left: 0, bottom: 50, right: 50 }] as never);
    document.getSelection()!.removeAllRanges();
    fromParent({ type: "highlight", annotations: [{ id: "ann_3", start: 10, end: 15, state: "open" }] });
    document.querySelector("p")!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
    rects.mockRestore();
    expect(posted.some((each) => (each as { id?: string }).id === "ann_3")).toBe(false);
  });

  it("keeps sending the text of a page that changes faster than the throttle", async () => {
    const clock = document.createElement("span");
    document.body.append(clock);
    let tick = 0;
    const timer = setInterval(() => {
      clock.textContent = `t${++tick}`;
    }, 40);
    await new Promise((resolve) => setTimeout(resolve, 500));
    clearInterval(timer);
    const texts = posted.filter((each) => (each as { type: string }).type === "text" && /t\d+$/.test((each as { text: string }).text));
    expect(texts.length).toBeGreaterThan(1);
  });

  it("only listens to its parent", () => {
    // Bridges from earlier tests still listen, so this one uses its own id.
    fromParent({ type: "highlight", annotations: [{ id: "ann_2", start: 10, end: 15, state: "open" }] }, null);
    fromParent({ type: "reveal", id: "ann_2" });
    expect(posted.some((each) => (each as { type: string }).type === "click")).toBe(false);
  });
});
