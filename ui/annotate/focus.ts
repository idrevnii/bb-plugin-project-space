// "Show this annotation": the Review tab asks, the open page's annotator
// answers by scrolling to it and opening its comment. A small module-level
// store, because the tab and the page are separate React trees. The page may
// still be loading after the tab navigates there, so a request waits (up to
// `TTL_MS`) until a viewer for its file takes it.
import { useSyncExternalStore } from "react";

interface FocusRequest {
  projectId: string;
  path: string;
  id: string;
  expiresAt: number;
}

const TTL_MS = 10_000;

let request: FocusRequest | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestAnnotationFocus(projectId: string, path: string, id: string) {
  request = { projectId, path, id, expiresAt: Date.now() + TTL_MS };
  emit();
}

/** The annotation id to show on this page, until `takeAnnotationFocus`. */
export function useAnnotationFocus(projectId: string, path: string): string | null {
  return useSyncExternalStore(subscribe, () =>
    request !== null && request.projectId === projectId && request.path === path && request.expiresAt > Date.now()
      ? request.id
      : null,
  );
}

/** Marks the request for `id` as handled. */
export function takeAnnotationFocus(id: string) {
  if (request?.id !== id) return;
  request = null;
  emit();
}
