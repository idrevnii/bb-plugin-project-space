// A `.tldr` file as a live tldraw editor. The file on disk is tldraw's own
// format, so it also opens on tldraw.com. Edits save after a short pause with
// a compare-and-swap on the file's sha; an outside change (an agent rewriting
// the file) reloads the board when there are no unsaved edits.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Tldraw,
  getSnapshot,
  loadSnapshot,
  parseTldrawJsonFile,
  serializeTldrawJson,
  type Editor,
} from "tldraw";
import "tldraw/tldraw.css";
import { useRealtime } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import type { SpaceFile } from "../server";
import { errorMessage, type SpaceRpc } from "./data";
import { applyBatches, waitForFonts } from "./draw-queue";

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

function useHostColorScheme(): "dark" | "light" {
  return useSyncExternalStore(subscribeToHostTheme, () =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
}

function loadInto(editor: Editor, json: string): string | null {
  if (json.trim() === "") return null;
  const parsed = parseTldrawJsonFile({ json, schema: editor.store.schema });
  if (!parsed.ok) {
    return `This file is not a readable tldraw document (${parsed.error.type}).`;
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"saved" | "saving" | "unsaved" | "conflict">("saved");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const colorScheme = useHostColorScheme();

  /** Saves unsaved edits; true when the file now holds them. */
  const save = useCallback(async (): Promise<boolean> => {
    const editor = editorRef.current;
    if (editor === null || !dirty.current) return false;
    dirty.current = false;
    setStatus("saving");
    try {
      const content = await serializeTldrawJson(editor);
      const result = await rpc.call("space_write", {
        projectId,
        path: file.path,
        content,
        expectedSha256: knownSha.current,
      });
      if (result.outcome === "written") {
        knownSha.current = result.sha256;
        setStatus(dirty.current ? "unsaved" : "saved");
        setSaveError(null);
        return true;
      }
      dirty.current = true;
      setStatus("conflict");
      return false;
    } catch (cause) {
      dirty.current = true;
      setStatus("unsaved");
      setSaveError(errorMessage(cause));
      return false;
    }
  }, [rpc, projectId, file.path]);

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
      const done = applyBatches(editor, batches);
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
  }, [rpc, projectId, file.path, save]);

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

  // Someone else rewrote the file.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null || file.sha256 === knownSha.current) return;
    if (dirty.current) {
      setStatus("conflict");
      return;
    }
    loading.current = true;
    try {
      setLoadError(loadInto(editor, file.content));
      knownSha.current = file.sha256;
    } finally {
      loading.current = false;
    }
  }, [file]);

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
      // Open on the whole drawing, not wherever the origin happens to be.
      if (editor.getCurrentPageShapeIds().size > 0) {
        editor.zoomToFit({ animation: { duration: 0 } });
      }
      void applyPending();
      const stop = editor.store.listen(
        () => {
          if (loading.current) return;
          dirty.current = true;
          setStatus("unsaved");
          scheduleSave();
        },
        { source: "user", scope: "document" },
      );
      return () => {
        stop();
        editorRef.current = null;
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
      <Tldraw
        onMount={handleMount}
        colorScheme={colorScheme}
        {...(licenseKey === "" ? {} : { licenseKey })}
      />
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
            {loadError}
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
