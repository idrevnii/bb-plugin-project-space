// Off-screen renderer: applies agents' drawing batches to .tldr files that
// nobody has open. Adapted from bb-plugin-canvas's headless renderer (MIT,
// (c) 2026 Borja Marquez de la Plata).
//
// Every bb window keeps one hidden tldraw editor and polls the queue while
// visible. A batch is left alone for one poll after it is first seen, so an
// open canvas — which applies at once on the realtime signal — nearly always
// wins. Deterministic shape ids make a double apply converge anyway, and the
// compare-and-swap write keeps two windows from clobbering each other.
//
// It also answers render-only batches (a view asking for a picture of a
// canvas, server/canvas-image.ts) and posts a picture after every write.
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Tldraw,
  getSnapshot,
  loadSnapshot,
  parseTldrawJsonFile,
  type Editor,
} from "tldraw";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import type { DrawBatch, SpaceFile } from "../server";
import { NO_USERS, serializeCanvas } from "./canvas-file";
import { postCanvasError, postCanvasImage } from "./canvas-image";
import { applyBatches, isRenderOnly, waitForFonts } from "./draw-queue";
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
      const parsed =
        file !== null && file.content.trim() !== ""
          ? parseTldrawJsonFile({ json: file.content, schema: editor.store.schema })
          : null;
      /** Why the file could not be loaded; the board is then blank. */
      const unreadable =
        parsed !== null && !parsed.ok
          ? `it is not a readable tldraw document (${parsed.error.type})`
          : null;
      editor.store.mergeRemoteChanges(() => {
        if (blank.current) loadSnapshot(editor.store, { document: blank.current });
        if (parsed?.ok) {
          loadSnapshot(editor.store, { document: getSnapshot(parsed.value).document });
        }
      });
      const put = (input: unknown) => rpc("space_canvas_image_put", input);
      const draws = batches.filter((batch) => !isRenderOnly(batch));
      const renders = batches.filter(isRenderOnly).map((batch) => batch.id);
      if (draws.length === 0) {
        // Only pictures asked for: show the file as it is, without writing.
        // A file that cannot be loaded is reported, not pictured as blank.
        // Unless the server has the answer, keep the request for next poll.
        const target = file === null ? null : { projectId, path, sha256: file.sha256 };
        const posted =
          target === null ||
          (unreadable === null
            ? await postCanvasImage(put, editor, target)
            : await postCanvasError(put, target, unreadable));
        if (posted) await rpc("space_draw_ack", { ids: renders });
        return;
      }
      if (unreadable !== null && file !== null) {
        // Drawing on the blank board would overwrite the file. Report it;
        // space_draw sees the error and withdraws its batch.
        const target = { projectId, path, sha256: file.sha256 };
        if (await postCanvasError(put, target, unreadable)) {
          await rpc("space_draw_ack", { ids: renders });
        }
        return;
      }
      const done = applyBatches(editor, draws);
      const result = (await rpc("space_write", {
        projectId,
        path,
        content: await serializeCanvas(editor),
        expectedSha256: file?.sha256 ?? null,
      })) as { outcome: string; sha256?: string };
      // A conflict means someone saved meanwhile; the next poll retries.
      if (result.outcome !== "written") return;
      // Before the ack, so a view right after the draw finds the picture.
      if (result.sha256 !== undefined) {
        await postCanvasImage(put, editor, { projectId, path, sha256: result.sha256 });
      }
      await rpc("space_draw_ack", { ids: [...done, ...renders] });
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
          // Give an open canvas the first go at drawing; a picture request is
          // answered at once, since a view is waiting on it.
          if (!seen.current.has(key) && !group.every(isRenderOnly)) continue;
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
      users={NO_USERS}
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
    // Synchronous on purpose: bb treats every DOM move as the plugin's while
    // a mount promise is pending, and blocks its own app shell's inserts
    // ("tried to move <div> out of React's tree"). The fetch runs detached.
    mount({ pluginId, signal }) {
      const rpc = rpcFor(pluginId);
      let unmount = () => {};
      void (async () => {
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
        unmount = mountRenderer(rpc, licenseKey, signal);
      })();
      return () => unmount();
    },
  });
}

function mountRenderer(rpc: Rpc, licenseKey: string, signal: AbortSignal): () => void {
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
}
