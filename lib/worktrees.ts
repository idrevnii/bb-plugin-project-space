// Pure helpers for worktree awareness: which changed repository paths are
// space files, and how a worktree's copy compares with the main space.
import { SPACE_DIR, normalizeSpacePath } from "./space";

export type WorktreeChange = "added" | "modified" | "deleted";

/**
 * The space-relative path of a repository-relative path inside a
 * `.bb-space/` folder, or null outside it. Hidden entries (plugin
 * bookkeeping such as `.space/`) are left out, as the file tree does.
 */
export function spacePathOfRepoPath(repoPath: string): string | null {
  const segments = repoPath.split("/");
  const at = segments.indexOf(SPACE_DIR);
  if (at === -1) return null;
  const rest = segments.slice(at + 1);
  if (rest.length === 0 || rest.some((segment) => segment.startsWith("."))) return null;
  const path = normalizeSpacePath(rest.join("/"));
  return path === null || path === "" ? null : path;
}

/** How the worktree's file differs from the main space's; null when it does not. */
export function classifyChange(
  worktreeSha: string | null,
  mainSha: string | null,
): WorktreeChange | null {
  if (worktreeSha === mainSha) return null;
  if (worktreeSha === null) return "deleted";
  if (mainSha === null) return "added";
  return "modified";
}

/**
 * Splits a Space route's sub-path at the `?env=<id>` query that marks a
 * worktree view. The host encodes `?` in panel sub-paths, so it may arrive
 * raw (decoded once) or as `%3F`.
 */
export function splitEnvQuery(subPath: string): { rest: string; env: string | null } {
  const match = /(\?|%3F)env(=|%3D)([^/?&%]+)/i.exec(subPath);
  if (match === null) return { rest: subPath, env: null };
  return { rest: subPath.slice(0, match.index), env: match[3] ?? null };
}
