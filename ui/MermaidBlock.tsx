// A fenced ```mermaid block as a diagram. Mermaid loads on first use, renders
// with `securityLevel: "strict"`, and follows bb's theme (the `dark` class on
// the root element), re-rendering when it flips. A diagram that fails to parse
// shows the error line and the source in bb's source viewer.
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { experimental_SourceCode as SourceCode } from "@get-bb/plugin-sdk/app";

type Mermaid = typeof import("mermaid").default;
type ColorScheme = "dark" | "light";

let mermaidPromise: Promise<Mermaid> | null = null;
function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import("mermaid").then((module) => module.default);
  return mermaidPromise;
}

function subscribeToHostTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function useHostColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribeToHostTheme, () =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
}

// mermaid's config is global; renders run one at a time so each one
// initializes with its own theme before rendering.
let queue: Promise<unknown> = Promise.resolve();
let renderCount = 0;

function renderDiagram(code: string, colorScheme: ColorScheme, idPrefix: string): Promise<string> {
  const job = queue.then(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: colorScheme === "dark" ? "dark" : "default",
      suppressErrorRendering: true,
    });
    const { svg } = await mermaid.render(`${idPrefix}-${++renderCount}`, code);
    return svg;
  });
  queue = job.catch(() => undefined);
  return job;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; svg: string }
  | { kind: "error"; message: string };

/**
 * The line of mermaid's error that names a source line (else its first line),
 * plus its "Expecting …, got …" detail when there is one.
 */
function errorLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lines = message.split("\n").map((line) => line.trim()).filter(Boolean);
  const head = lines.find((line) => /line \d+/i.test(line)) ?? lines[0] ?? "Invalid diagram";
  const detail = lines.find((line) => /^Expecting\b/.test(line));
  return detail === undefined ? head : `${head} ${detail}`;
}

export function MermaidBlock({ code }: { code: string }) {
  const colorScheme = useHostColorScheme();
  const idPrefix = `mermaid-${useId().replace(/[^\w-]/g, "")}`;
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    renderDiagram(code, colorScheme, idPrefix).then(
      (svg) => {
        if (!cancelled) setState({ kind: "ready", svg });
      },
      (error: unknown) => {
        if (!cancelled) setState({ kind: "error", message: errorLine(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, colorScheme, idPrefix]);

  if (state.kind === "error") {
    return (
      <div
        data-mermaid="error"
        className="not-prose my-4 overflow-hidden rounded-lg border border-destructive/50 bg-card text-[13px]"
      >
        <div className="border-b border-border px-3 py-1.5 font-mono text-[12px] text-destructive">
          mermaid: {state.message}
        </div>
        <SourceCode content={code} path="diagram.mmd" overflow="scroll" />
      </div>
    );
  }
  return (
    <div
      data-mermaid={state.kind}
      className="not-prose my-4 flex justify-center overflow-x-auto rounded-lg border border-border bg-card p-4 [&_svg]:h-auto [&_svg]:max-w-full"
      // Rendered by mermaid with securityLevel "strict": label HTML is
      // sanitized (no scripts or event handlers), click directives disabled.
      dangerouslySetInnerHTML={state.kind === "ready" ? { __html: state.svg } : undefined}
    >
      {state.kind === "loading" ? (
        <span className="text-xs text-muted-foreground">Rendering diagram…</span>
      ) : undefined}
    </div>
  );
}
