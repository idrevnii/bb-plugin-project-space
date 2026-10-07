// Data hooks over the plugin RPC. Every hook refetches on the server's
// `space-changed` signal for its project, and on reconnect, so agents' writes
// show up without a reload. When the server cannot watch the project's host
// (an enrolled remote machine), hooks fall back to polling.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { SPACE_ANNOTATIONS_CHANGED, type Annotation } from "../lib/annotations";
import { copySummary } from "../lib/worktrees";
import type {
  SpaceFile,
  SpaceInfo,
  SpaceTreeEntry,
  SpaceWorktree,
  rpcContract,
} from "../server";

export type SpaceRpc = ReturnType<typeof useSpaceRpc>;

export function useSpaceRpc() {
  return useRpc<typeof rpcContract>();
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const POLL_MS = 5000;

/** Calls `refetch` whenever this project's space may have changed. */
function useSpaceChanges(
  projectId: string | null,
  watching: boolean,
  refetch: () => void,
) {
  const latest = useRef(refetch);
  latest.current = refetch;
  useRealtime("space-changed", (payload) => {
    if (
      projectId !== null &&
      typeof payload === "object" &&
      payload !== null &&
      (payload as { projectId?: unknown }).projectId === projectId
    ) {
      latest.current();
    }
  });
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(connection === "connected");
  useEffect(() => {
    if (connection === "connected" && !wasConnected.current) latest.current();
    wasConnected.current = connection === "connected";
  }, [connection]);
  useEffect(() => {
    if (projectId === null || watching) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") latest.current();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [projectId, watching]);
}

export function useSpaceInfo(projectId: string | null) {
  const rpc = useSpaceRpc();
  const [info, setInfo] = useState<SpaceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    if (projectId === null) return;
    rpc.call("space_info", { projectId }).then(
      (next) => {
        setInfo(next);
        setError(null);
      },
      (cause) => setError(errorMessage(cause)),
    );
  }, [rpc, projectId]);
  useEffect(() => {
    setInfo(null);
    setError(null);
    refetch();
  }, [refetch]);
  useSpaceChanges(projectId, info?.watching ?? true, refetch);
  return { info, error, refetch };
}

export function useSpaceTree(projectId: string | null, watching: boolean) {
  const rpc = useSpaceRpc();
  const [entries, setEntries] = useState<SpaceTreeEntry[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    if (projectId === null) return;
    rpc.call("space_tree", { projectId }).then(
      (result) => {
        setEntries(result.entries);
        setTruncated(result.truncated);
        setError(null);
      },
      (cause) => setError(errorMessage(cause)),
    );
  }, [rpc, projectId]);
  useEffect(() => {
    setEntries(null);
    refetch();
  }, [refetch]);
  useSpaceChanges(projectId, watching, refetch);
  return { entries, truncated, error, refetch };
}

/**
 * The open file. `file` keeps the last good read; a later read that returns
 * a different sha replaces it, so viewers can tell an outside change apart
 * from their own save by comparing shas.
 */
export function useSpaceFile(
  projectId: string | null,
  path: string | null,
  watching: boolean,
) {
  const rpc = useSpaceRpc();
  const [file, setFile] = useState<SpaceFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const refetch = useCallback(() => {
    if (projectId === null || path === null || path === "") return;
    rpc.call("space_read", { projectId, path }).then(
      (next) => {
        setFile((previous) =>
          previous !== null &&
          previous.path === next.path &&
          previous.sha256 === next.sha256
            ? previous
            : next,
        );
        setMissing(false);
        setError(null);
      },
      (cause) => {
        const message = errorMessage(cause);
        if (/not found|ENOENT|no such file/i.test(message)) setMissing(true);
        else setError(message);
      },
    );
  }, [rpc, projectId, path]);
  useEffect(() => {
    setFile(null);
    setMissing(false);
    setError(null);
    refetch();
  }, [refetch]);
  useSpaceChanges(projectId, watching, refetch);
  return { file, error, missing, refetch, setFile };
}

/** A preview base URL for serving space files to <img> and <iframe>. */
export function useSpacePreview(projectId: string | null) {
  const rpc = useSpaceRpc();
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      rpc.call("space_preview", { projectId }).then(
        (preview) => {
          if (cancelled) return;
          setBaseUrl(preview.baseUrl);
          // Renew a little before the server-side cache would.
          const renewIn = Math.max(
            60_000,
            preview.expiresAtMs - Date.now() - 15 * 60_000,
          );
          timer = setTimeout(load, renewIn);
        },
        () => {
          if (!cancelled) timer = setTimeout(load, 30_000);
        },
      );
    };
    setBaseUrl(null);
    load();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [rpc, projectId]);
  return baseUrl;
}

/**
 * A file's annotations, oldest first. Refetches on `space-annotations-changed`
 * for the file and on reconnect; `null` until the first answer.
 */
export function useAnnotations(projectId: string, path: string) {
  const rpc = useSpaceRpc();
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("annotations_list", { projectId, path }).then(
      (result) => {
        setAnnotations(result.annotations as Annotation[]);
        setError(null);
      },
      (cause) => setError(errorMessage(cause)),
    );
  }, [rpc, projectId, path]);
  useEffect(() => {
    setAnnotations(null);
    setError(null);
    refetch();
  }, [refetch]);
  const latest = useRef(refetch);
  latest.current = refetch;
  useRealtime(SPACE_ANNOTATIONS_CHANGED, (payload) => {
    const change = payload as { projectId?: unknown; path?: unknown } | null;
    if (change?.projectId === projectId && change.path === path) latest.current();
  });
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(connection === "connected");
  useEffect(() => {
    if (connection === "connected" && !wasConnected.current) latest.current();
    wasConnected.current = connection === "connected";
  }, [connection]);
  return { annotations, error, refetch };
}

/**
 * Every annotation in a project's space, oldest first. Refetches (coalesced)
 * on any `space-annotations-changed` for the project and on reconnect.
 */
export function useProjectAnnotations(projectId: string | null) {
  const rpc = useSpaceRpc();
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    if (projectId === null) return;
    rpc.call("annotations_list", { projectId }).then(
      (result) => {
        setAnnotations(result.annotations as Annotation[]);
        setError(null);
      },
      (cause) => setError(errorMessage(cause)),
    );
  }, [rpc, projectId]);
  useEffect(() => {
    setAnnotations(null);
    setError(null);
    refetch();
  }, [refetch]);
  const latest = useRef(refetch);
  latest.current = refetch;
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (pending.current !== null) clearTimeout(pending.current);
  }, []);
  useRealtime(SPACE_ANNOTATIONS_CHANGED, (payload) => {
    const change = payload as { projectId?: unknown } | null;
    if (projectId === null || change?.projectId !== projectId || pending.current !== null) return;
    // One send touches several files; read once after the burst.
    pending.current = setTimeout(() => {
      pending.current = null;
      latest.current();
    }, 150);
  });
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(connection === "connected");
  useEffect(() => {
    if (connection === "connected" && !wasConnected.current) latest.current();
    wasConnected.current = connection === "connected";
  }, [connection]);
  return { annotations, error, refetch };
}

const WORKTREES_POLL_MS = 60_000;

/**
 * Worktrees whose space differs from the main one. Worktrees are not
 * watched, so this polls (gently) on top of the main space's change signal.
 * With no worktrees the server answers from one environment listing.
 */
export function useSpaceWorktrees(projectId: string) {
  const rpc = useSpaceRpc();
  const [worktrees, setWorktrees] = useState<SpaceWorktree[]>([]);
  const refetch = useCallback(() => {
    rpc.call("space_worktrees", { projectId }).then(
      (result) =>
        // A new but equal answer would re-render the whole page every poll.
        setWorktrees((previous) =>
          JSON.stringify(previous) === JSON.stringify(result.worktrees) ? previous : result.worktrees,
        ),
      () => {
        // Keep the last answer; the badge is advisory.
      },
    );
  }, [rpc, projectId]);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => {
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      refetch();
    }, 1000);
  }, [refetch]);
  useEffect(() => {
    refetch();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refetch();
    }, WORKTREES_POLL_MS);
    return () => {
      clearInterval(timer);
      if (pending.current !== null) clearTimeout(pending.current);
    };
  }, [refetch]);
  // Main-space edits can settle a difference too; polling covers the rest.
  useSpaceChanges(projectId, true, soon);
  return worktrees;
}

/** A worktree's copy of a space file, re-read every few seconds while visible. */
export function useWorktreeFile(projectId: string, environmentId: string, path: string) {
  const rpc = useSpaceRpc();
  const [state, setState] = useState<{
    file: SpaceFile;
    branch: string | null;
    checkout: { hostId: string; path: string };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    if (path === "") return;
    rpc.call("space_worktree_read", { projectId, environmentId, path }).then(
      (next) => {
        setState((previous) =>
          previous !== null && previous.file.path === next.file.path && previous.file.sha256 === next.file.sha256
            ? previous
            : { file: next.file, branch: next.branch, checkout: { hostId: next.hostId, path: next.checkoutPath } },
        );
        setError(null);
      },
      (cause) => setError(errorMessage(cause)),
    );
  }, [rpc, projectId, environmentId, path]);
  useEffect(() => {
    setState(null);
    setError(null);
    refetch();
  }, [refetch]);
  useSpaceChanges(projectId, false, refetch);
  return { ...(state ?? { file: null, branch: null, checkout: null }), error };
}

export type WorktreeFile = SpaceWorktree["files"][number];

/**
 * Copies files of one worktree into the main space. The server checks both
 * shas from the listing, so a side that changed since is left alone.
 * `message` says what happened; the badge refetches on `space-changed`.
 */
export function useWorktreeCopy(projectId: string, environmentId: string) {
  const rpc = useSpaceRpc();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const copy = useCallback(
    async (files: WorktreeFile[]): Promise<boolean> => {
      setBusy(true);
      setMessage(null);
      try {
        const result = await rpc.call("space_worktree_copy", {
          projectId,
          environmentId,
          files: files.map(({ path, worktreeSha256, mainSha256 }) => ({ path, worktreeSha256, mainSha256 })),
        });
        const outcomes = result.files.map((file) => file.outcome);
        setMessage(copySummary(outcomes));
        return outcomes.every((outcome) => outcome === "copied");
      } catch (cause) {
        setMessage(`The copy failed: ${errorMessage(cause)}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [rpc, projectId, environmentId],
  );
  return { copy, busy, message };
}
