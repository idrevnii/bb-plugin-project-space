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
import type {
  SpaceFile,
  SpaceInfo,
  SpaceTreeEntry,
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
