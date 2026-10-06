// Pure rules for moving a tree entry into a folder (drag and drop, Move to…).
import { baseName, joinSpacePath, parentOf } from "../lib/space";

export type MovePlan =
  | { kind: "noop" }
  | { kind: "refuse"; reason: string }
  | { kind: "move"; from: string; to: string };

/** Where `from` lands when moved into `folder` ("" is the space root). */
export function planMove(from: string, folder: string, exists: (path: string) => boolean): MovePlan {
  if (folder === from || folder.startsWith(`${from}/`)) {
    return { kind: "refuse", reason: `Can't move ${from} into itself` };
  }
  if (parentOf(from) === folder) return { kind: "noop" };
  const to = joinSpacePath(folder, baseName(from));
  if (exists(to)) return { kind: "refuse", reason: `${to} already exists` };
  return { kind: "move", from, to };
}

/** The new path of `path` after `from` moved to `to`, or null if unaffected. */
export function followMove(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  return null;
}

/** Folders `from` can be moved into: the root and every folder, minus no-ops and itself. */
export function moveDestinations(from: string, folders: string[]): string[] {
  return ["", ...folders].filter(
    (folder) => folder !== parentOf(from) && folder !== from && !folder.startsWith(`${from}/`),
  );
}
