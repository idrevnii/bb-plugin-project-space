// Off-screen renderer: applies agents' drawing batches to .tldr files that
// nobody has open. Adapted from bb-plugin-canvas's headless renderer (MIT,
// (c) 2026 Borja Marquez de la Plata).
//
// Every bb window keeps one hidden tldraw editor and polls the queue while
// visible. A batch is left alone for one poll after it is first seen, so an
// open canvas — which applies at once on the realtime signal — nearly always
// wins. Deterministic shape ids make a double apply converge anyway, and the
// compare-and-swap write keeps two windows from clobbering each other.
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Tldraw,
  getSnapshot,
  loadSnapshot,
  parseTldrawJsonFile,
  serializeTldrawJson,
  type Editor,
} from "tldraw";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import type { DrawBatch, SpaceFile } from "../server";
import { applyBatches, waitForFonts } from "./draw-queue";
import { isTldrawDevelopmentOrigin } from "./TldrawView";

const POLL_MS = 3000;
/** Big enough that auto-layout and zoom-to-fit behave as on screen. */
const STAGE_W = 1400;
const STAGE_H = 900;

type Rpc = (method: string, input: unknown) => Promise<unknown>;

/** The SDK's RPC transport, without the React hook a content script lacks. */
function rpcFor(pluginId: string): Rpc {
  return async (method, input) => {
    const response = await fetch(
      `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/${encodeURIComponent(method)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input ?? null),
      },
    );
    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; result?: unknown; error?: { message?: string } }
      | null;
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.error?.message ?? `rpc ${method} failed (HTTP ${response.status})`);
    }
    return body.result;
  };
}

function groupKey(batch: DrawBatch): string {
  return `${batch.projectId}\n${batch.path}`;
}

function HeadlessRenderer({
  rpc,
  licenseKey,
  signal,
}: {
  rpc: Rpc;
  licenseKey: string;
  signal: AbortSignal;
}) {
  const editorRef = useRef<Editor | null>(null);
  const blank = useRef<ReturnType<typeof getSnapshot>["document"] | null>(null);
  const seen = useRef(new Set<string>());
  const busy = useRef(false);

  useEffect(() => {
    let stopped = false;

    const render = async (editor: Editor, batches: DrawBatch[]) => {
      const { projectId, path } = batches[0]!;
      let file: SpaceFile | null = null;
      try {
        file = (await rpc("space_read", { projectId, path })) as SpaceFile;
      } catch {
        file = null; // removed since it was queued: draw onto a new board
      }
      await waitForFonts(editor);
      editor.store.mergeRemoteChanges(() => {
        if (blank.current) loadSnapshot(editor.store, { document: blank.current });
        if (file !== null && file.content.trim() !== "") {
          const parsed = parseTldrawJsonFile({ json: file.content, schema: editor.store.schema });
          if (parsed.ok) {
            loadSnapshot(editor.store, { document: getSnapshot(parsed.value).document });
          }
        }
      });
      const done = applyBatches(editor, batches);
      const result = (await rpc("space_write", {
        projectId,
        path,
        content: await serializeTldrawJson(editor),
        expectedSha256: file?.sha256 ?? null,
      })) as { outcome: string };
      // A conflict means someone saved meanwhile; the next poll retries.
      if (result.outcome === "written") await rpc("space_draw_ack", { ids: done });
    };

    const tick = async () => {
      const editor = editorRef.current;
      if (stopped || busy.current || editor === null) return;
      if (document.visibilityState === "hidden") return;
      busy.current = true;
      try {
        const { batches } = (await rpc("space_draw_pending", {})) as { batches: DrawBatch[] };
        const groups = new Map<string, DrawBatch[]>();
        for (const batch of batches) {
          const key = groupKey(batch);
          groups.set(key, [...(groups.get(key) ?? []), batch]);
        }
        for (const [key, group] of groups) {
          if (stopped) break;
          if (!seen.current.has(key)) continue; // give an open canvas the first go
          try {
            await render(editor, group);
          } catch (cause) {
            console.warn(`project-space: off-screen render of ${key} failed`, cause);
          }
        }
        seen.current = new Set(groups.keys());
      } catch {
        // Server unreachable or reloading: try again next tick.
      } finally {
        busy.current = false;
      }
    };

    const timer = setInterval(() => void tick(), POLL_MS);
    void tick();
    const stop = () => {
      stopped = true;
      clearInterval(timer);
    };
    signal.addEventListener("abort", stop, { once: true });
    return () => {
      stop();
      signal.removeEventListener("abort", stop);
    };
  }, [rpc, signal]);

  return (
    <Tldraw
      hideUi
      onMount={(editor) => {
        editorRef.current = editor;
        blank.current = getSnapshot(editor.store).document;
      }}
      {...(licenseKey === "" ? {} : { licenseKey })}
    />
  );
}

export function registerHeadlessRenderer(app: PluginAppBuilder) {
  app.contentScripts.register({
    id: "headless-canvas-renderer",
    async mount({ pluginId, signal }) {
      const rpc = rpcFor(pluginId);
      let licenseKey = "";
      try {
        licenseKey = ((await rpc("space_canvas_config", null)) as { licenseKey: string }).licenseKey;
      } catch {
        // No server yet: run without a key.
      }
      // Unlicensed on a non-local https origin tldraw hides itself; the page
      // refuses to mount there, and so does this.
      if (!isTldrawDevelopmentOrigin() && licenseKey === "") return;
      if (signal.aborted) return;

      const host = document.createElement("div");
      host.setAttribute("data-project-space-headless", "");
      host.setAttribute("aria-hidden", "true");
      // Laid out but invisible: display:none would leave tldraw no geometry.
      Object.assign(host.style, {
        position: "fixed",
        left: "-20000px",
        top: "0",
        width: `${STAGE_W}px`,
        height: `${STAGE_H}px`,
        opacity: "0",
        pointerEvents: "none",
        overflow: "hidden",
      } satisfies Partial<CSSStyleDeclaration>);
      document.body.appendChild(host);
      const root = createRoot(host);
      root.render(
        <StrictMode>
          <HeadlessRenderer rpc={rpc} licenseKey={licenseKey} signal={signal} />
        </StrictMode>,
      );
      return () => {
        root.unmount();
        host.remove();
      };
    },
  });
}
