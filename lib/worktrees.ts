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

/**
 * Whether the main space changed a file after the branch left it, so a copy
 * from the worktree replaces that change. `baseSha` is the file's sha at the
 * merge base (null: it did not exist there); undefined when git cannot say,
 * and then the answer is null (unknown).
 */
export function mainChangedSinceBase(
  mainSha: string | null,
  baseSha: string | null | undefined,
): boolean | null {
  if (baseSha === undefined) return null;
  return mainSha !== baseSha;
}

export type CopyOutcome = "copied" | "conflict" | "stale";

/** One line about a copy: how many files arrived and why the others did not. */
export function copySummary(outcomes: CopyOutcome[]): string {
  const count = (outcome: CopyOutcome) => outcomes.filter((value) => value === outcome).length;
  const files = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;
  const parts: string[] = [];
  const copied = count("copied");
  const conflicts = count("conflict");
  const stale = count("stale");
  if (copied > 0 || outcomes.length === 0) parts.push(`Copied ${files(copied)}.`);
  if (conflicts > 0) {
    parts.push(`${files(conflicts)} changed in the main space after the list was made. Nothing was copied over ${conflicts === 1 ? "it" : "them"}.`);
  }
  if (stale > 0) {
    parts.push(`${files(stale)} changed in the worktree after the list was made. Look again and copy ${stale === 1 ? "it" : "them"} again.`);
  }
  return parts.join(" ");
}
