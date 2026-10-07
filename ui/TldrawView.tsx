// A `.tldr` file as a live tldraw editor. The file on disk is tldraw's own
// format, so it also opens on tldraw.com. Edits save after a short pause with
// a compare-and-swap on the file's sha; an outside change (an agent rewriting
// the file) reloads the board when there are no unsaved edits. Every save
// also posts a picture of the board for agents (ui/canvas-image.ts).
// Comments on shapes are drawn over the board by ui/annotate/tldraw.tsx.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Tldraw,
  getSnapshot,
  loadSnapshot,
  parseTldrawJsonFile,
  type Editor,
} from "tldraw";
import "tldraw/tldraw.css";
import { useRealtime } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import type { SpaceFile } from "../server";
import { errorMessage, type SpaceRpc } from "./data";
import { NO_USERS, serializeCanvas } from "./canvas-file";
import { postCanvasError, postCanvasImage } from "./canvas-image";
import { applyBatches, isRenderOnly, waitForFonts } from "./draw-queue";
import { CanvasAnnotations, canvasAnnotationComponents } from "./annotate/tldraw";

const SAVE_DELAY_MS = 800;

export function isTldrawDevelopmentOrigin(): boolean {
  const { protocol, hostname } = window.location;
  return (
    protocol === "http:" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

/** bb's theme is the `dark` class on the root element; follow it live. */
function subscribeToHostTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function useHostColorScheme(): "dark" | "light" {
  return useSyncExternalStore(subscribeToHostTheme, () =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
}

export function loadInto(editor: Editor, json: string): string | null {
  if (json.trim() === "") return null;
  const parsed = parseTldrawJsonFile({ json, schema: editor.store.schema });
  if (!parsed.ok) {
    // Phrased to follow "cannot be pictured: " / "was not drawn on: ".
    return `it is not a readable tldraw document (${parsed.error.type})`;
  }
  const snapshot = getSnapshot(parsed.value);
  // As a remote change, so the user-only save listener ignores the load.
  editor.store.mergeRemoteChanges(() => {
    loadSnapshot(editor.store, { document: snapshot.document });
  });
  return null;
}

export function TldrawView({
  projectId,
  file,
  rpc,
  licenseKey,
}: {
  projectId: string;
  file: SpaceFile;
  rpc: SpaceRpc;
  licenseKey: string;
}) {
  const editorRef = useRef<Editor | null>(null);
  /** The sha we last read or wrote; outside changes differ from it. */
  const knownSha = useRef(file.sha256);
  const dirty = useRef(false);
  const loading = useRef(false);
  /**
   * A save is on its way. Until it answers, knownSha is stale: a new file
   * may be our own write echoing back, or an agent's that our save will
   * conflict with, so outside changes wait for the answer (see reconcile).
   */
  const saving = useRef(false);
  const changedWhileSaving = useRef(false);
  const latestFile = useRef(file);
  latestFile.current = file;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"saved" | "saving" | "unsaved" | "conflict">("saved");
  const [loadError, setLoadErrorState] = useState<string | null>(null);
  /** The load error as of now, for picture requests and saves (not a render). */
  const unreadable = useRef<string | null>(null);
  // A file that did not load leaves the board blank or stale; saving it
  // would overwrite the file. So the board is read-only until a load works.
  const setLoadError = useCallback((error: string | null) => {
    unreadable.current = error;
    setLoadErrorState(error);
    // Only on a change: setting it on every load marks the board touched.
    const editor = editorRef.current;
    if (editor !== null && editor.getInstanceState().isReadonly !== (error !== null)) {
      editor.updateInstanceState({ isReadonly: error !== null });
    }
  }, []);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The board has loaded the file once, so its shapes can be looked up. */
  const [mounted, setMounted] = useState(false);
  const colorScheme = useHostColorScheme();

  const putImage = useCallback(
    (input: { projectId: string; path: string; sha256: string; pngBase64: string; error?: string }) =>
      rpc.call("space_canvas_image_put", input),
    [rpc],
  );

  // Someone else rewrote the file.
  const reconcile = useCallback(() => {
    const editor = editorRef.current;
    const current = latestFile.current;
    if (editor === null || current.sha256 === knownSha.current) return;
    if (saving.current) {
      changedWhileSaving.current = true;
      return;
    }
    if (dirty.current) {
      setStatus("conflict");
      return;
    }
    const wasUnreadable = unreadable.current !== null;
    loading.current = true;
    try {
      setLoadError(loadInto(editor, current.content));
      knownSha.current = current.sha256;
    } finally {
      loading.current = false;
    }
    // A board that could not load showed nothing; frame the drawing as on open.
    if (wasUnreadable && unreadable.current === null && editor.getCurrentPageShapeIds().size > 0) {
      editor.zoomToFit({ animation: { duration: 0 } });
    }
  }, [setLoadError]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    const editor = editorRef.current;
    if (editor === null || !dirty.current) return false;
    if (unreadable.current !== null) {
      dirty.current = false;
      setStatus("saved");
      return false;
    }
    dirty.current = false;
    saving.current = true;
    changedWhileSaving.current = false;
    setStatus("saving");
    let sha256: string;
    try {
      const content = await serializeCanvas(editor);
      const result = await rpc.call("space_write", {
        projectId,
        path: file.path,
        content,
        expectedSha256: knownSha.current,
      });
      if (result.outcome !== "written") {
        dirty.current = true;
        setStatus("conflict");
        return false;
      }
      sha256 = result.sha256;
      knownSha.current = sha256;
    } catch (cause) {
      dirty.current = true;
      setStatus("unsaved");
      setSaveError(errorMessage(cause));
      return false;
    } finally {
      saving.current = false;
      if (changedWhileSaving.current) {
        changedWhileSaving.current = false;
        reconcile();
      }
    }
    setStatus((current) => (current === "conflict" ? current : dirty.current ? "unsaved" : "saved"));
    setSaveError(null);
    // Only if the board still is what was written.
    await postCanvasImage(
      putImage,
      editor,
      { projectId, path: file.path, sha256 },
      () => !dirty.current && knownSha.current === sha256,
    );
    return true;
  }, [rpc, projectId, file.path, putImage, reconcile]);

  /**
   * Saves unsaved edits; true when the file now holds them. One save at a
   * time, so each compares against the sha the one before it wrote.
   */
  const inFlight = useRef<Promise<boolean> | null>(null);
  const save = useCallback((): Promise<boolean> => {
    if (inFlight.current !== null) return inFlight.current.catch(() => false).then(() => save());
    const pending = saveNow().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = pending;
    return pending;
  }, [saveNow]);

  // Agents' drawing batches for this file land here first while it is open;
  // the off-screen renderer only picks up what no open canvas took.
  const applying = useRef(false);
  const applyPending = useCallback(async () => {
    const editor = editorRef.current;
    if (editor === null || applying.current) return;
    applying.current = true;
    try {
      const { batches } = await rpc.call("space_draw_pending", { projectId, path: file.path });
      if (batches.length === 0) return;
      await waitForFonts(editor);
      const draws = batches.filter((batch) => !isRenderOnly(batch));
      const renders = batches.filter(isRenderOnly).map((batch) => batch.id);
      if (draws.length === 0 && !dirty.current) {
        // A picture request. The board shows the file only if nobody has
        // rewritten it since we last loaded; otherwise leave the request to
        // the off-screen renderer, which reads the file afresh.
        const sha256 = knownSha.current;
        const latest = await rpc.call("space_read", { projectId, path: file.path });
        if (latest.sha256 !== sha256) return;
        const target = { projectId, path: file.path, sha256 };
        // A board edited meanwhile no longer shows the file; its save posts.
        const posted =
          unreadable.current === null
            ? await postCanvasImage(
                putImage,
                editor,
                target,
                () => !dirty.current && knownSha.current === sha256,
              )
            : await postCanvasError(putImage, target, unreadable.current);
        if (posted) await rpc.call("space_draw_ack", { ids: renders });
        return;
      }
      if (unreadable.current !== null) {
        // The board is blank because the file did not load; drawing on it
        // and saving would overwrite the file. Report it instead.
        await postCanvasError(
          putImage,
          { projectId, path: file.path, sha256: knownSha.current },
          unreadable.current,
        );
        return;
      }
      const done = [...applyBatches(editor, draws), ...renders];
      dirty.current = true;
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (await save()) await rpc.call("space_draw_ack", { ids: done });
    } catch (cause) {
      setSaveError(errorMessage(cause));
    } finally {
      applying.current = false;
    }
  }, [rpc, projectId, file.path, save, putImage]);

  useRealtime("space-draw", (payload) => {
    const signal = payload as { projectId?: unknown; path?: unknown } | null;
    if (signal?.projectId === projectId && signal.path === file.path) void applyPending();
  });

  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void save();
    }, SAVE_DELAY_MS);
  }, [save]);

  // Flush a pending save when the file closes.
  useEffect(
    () => () => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
        void save();
      }
    },
    [save],
  );

  useEffect(reconcile, [file, reconcile]);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      loading.current = true;
      try {
        setLoadError(loadInto(editor, file.content));
      } finally {
        loading.current = false;
      }
      knownSha.current = file.sha256;
      setMounted(true);
      // Open on the whole drawing, not wherever the origin happens to be.
      if (editor.getCurrentPageShapeIds().size > 0) {
        editor.zoomToFit({ animation: { duration: 0 } });
      }
      void applyPending();
      const stop = editor.store.listen(
        () => {
          if (loading.current) return;
          dirty.current = true;
          // Drawing on does not hide an open conflict.
          setStatus((current) => (current === "conflict" ? current : "unsaved"));
          scheduleSave();
        },
        { source: "user", scope: "document" },
      );
      return () => {
        stop();
        editorRef.current = null;
        setMounted(false);
      };
    },
    // The editor mounts once per file; later content arrives via the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheduleSave, applyPending],
  );

  const overwrite = useCallback(async () => {
    const latest = await rpc.call("space_read", { projectId, path: file.path });
    knownSha.current = latest.sha256;
    dirty.current = true;
    await save();
  }, [rpc, projectId, file.path, save]);

  const reload = useCallback(async () => {
    const editor = editorRef.current;
    if (editor === null) return;
    const latest = await rpc.call("space_read", { projectId, path: file.path });
    dirty.current = false;
    loading.current = true;
    try {
      setLoadError(loadInto(editor, latest.content));
    } finally {
      loading.current = false;
    }
    knownSha.current = latest.sha256;
    setStatus("saved");
  }, [rpc, projectId, file.path]);

  if (!isTldrawDevelopmentOrigin() && licenseKey === "") {
    return (
      <div className="mx-auto max-w-lg p-6 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">tldraw needs a license key on this address.</p>
        <p className="mt-2">
          tldraw runs free on local addresses (http or localhost). On a shared
          https address it hides its editor unless a key is configured. Set one
          with <code>bb plugin config project-space set tldrawLicenseKey "tldraw-…"</code>,
          or open bb locally. The file is safe on disk either way.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <CanvasAnnotations projectId={projectId} path={file.path} rpc={rpc} ready={mounted && loadError === null}>
        <Tldraw
          onMount={handleMount}
          users={NO_USERS}
          colorScheme={colorScheme}
          components={canvasAnnotationComponents}
          {...(licenseKey === "" ? {} : { licenseKey })}
        />
      </CanvasAnnotations>
      <div className="pointer-events-none absolute right-3 top-3 z-[400] flex flex-col items-end gap-2">
        {status === "conflict" ? (
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
            <span>The file changed on disk while you were drawing.</span>
            <Button size="sm" variant="outline" onClick={() => void reload()}>
              Load theirs
            </Button>
            <Button size="sm" variant="outline" onClick={() => void overwrite()}>
              Keep mine
            </Button>
          </div>
        ) : (
          <span className="rounded-md bg-card/80 px-2 py-0.5 text-[11px] text-muted-foreground shadow-sm">
            {status === "saving" ? "Saving…" : status === "unsaved" ? "Unsaved" : "Saved"}
          </span>
        )}
        {loadError ? (
          <span className="pointer-events-auto rounded-md bg-card px-2 py-1 text-xs text-destructive shadow-sm">
            This file cannot be shown: {loadError}. Editing is off until it is fixed.
          </span>
        ) : null}
        {saveError ? (
          <span className="pointer-events-auto rounded-md bg-card px-2 py-1 text-xs text-destructive shadow-sm">
            {saveError}
          </span>
        ) : null}
      </div>
    </div>
  );
}
