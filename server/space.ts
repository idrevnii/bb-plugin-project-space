// Project resolution and live change notifications, shared by every module.
//
// Every project gets a space: a directory in its default checkout,
// `.bb-space/` unless the *Space folder* setting names another. All file I/O goes through `bb.sdk.files` with the project
// source's host, so a project on an enrolled machine works the same as a
// local one. When that host is the server machine, a recursive fs.watch
// publishes `space-changed` so open pages follow agents' writes.
import { stat } from "node:fs/promises";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { normalizeSpaceDir, normalizeSpacePath } from "../lib/space";
import type { Settings } from "./index";
import { watchTree, type TreeWatcher } from "./watch-tree";

/** Realtime channel: payload `{ projectId }`. */
export const SPACE_CHANGED = "space-changed";

export const spacePath = z
  .string()
  .max(1024)
  .transform((value, ctx) => {
    const normalized = normalizeSpacePath(value);
    if (normalized === null) {
      ctx.addIssue({ code: "custom", message: `Invalid space path: ${value}` });
      return z.NEVER;
    }
    return normalized;
  });
export const nonRootSpacePath = spacePath.refine((value) => value !== "", {
  message: "Path must name a file or folder inside the space",
});
export const projectId = z.string().min(1).max(128);

export interface ProjectSpace {
  projectId: string;
  projectName: string;
  hostId: string;
  /** Absolute path of the project checkout on `hostId`. */
  checkoutPath: string;
  /** The space folder relative to the checkout (the *Space folder* setting). */
  spaceDir: string;
  /** Absolute path of the space folder on `hostId`. */
  rootPath: string;
  isLocal: boolean;
}

const PROJECT_CACHE_MS = 30_000;

export function absolute(space: ProjectSpace, path: string): string {
  return path === "" ? space.rootPath : `${space.rootPath}/${path}`;
}

/**
 * Whether `bb.sdk.files` failed because the path does not exist. The host
 * throws a BbHttpError with status 404; anything else (permissions, a host
 * that is down) is a real failure the caller must not read as "no file".
 */
export function isMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { status?: unknown }).status === 404) return true;
  return error instanceof Error && /\bHTTP 404\b/.test(error.message);
}

export function checkoutOf(space: ProjectSpace): string {
  return space.checkoutPath;
}

/**
 * Whether `checkout` on a host has the folder `spaceDir`, asked through
 * `bb.sdk.files`. listPaths does not fail for a missing directory, so this
 * looks for the folder by name from its parent instead.
 */
export async function hasSpaceDir(
  bb: BbPluginApi,
  hostId: string,
  checkout: string,
  spaceDir: string,
): Promise<boolean> {
  const cut = spaceDir.lastIndexOf("/");
  const name = spaceDir.slice(cut + 1);
  try {
    const result = await bb.sdk.files.listPaths({
      hostId,
      path: cut === -1 ? checkout : `${checkout}/${spaceDir.slice(0, cut)}`,
      query: name,
      includeFiles: false,
      includeDirectories: true,
      includeHidden: true,
      limit: 50,
    });
    return result.paths.some((entry) => entry.path === name);
  } catch {
    return false;
  }
}

export type Spaces = ReturnType<typeof createSpaces>;

export function createSpaces(bb: BbPluginApi, settings: Settings) {
  const projectCache = new Map<
    string,
    { space: ProjectSpace; loadedAt: number }
  >();
  let primaryHostId: string | null | undefined;

  async function serverHostId(): Promise<string | null> {
    if (primaryHostId === undefined) {
      primaryHostId = (await bb.sdk.system.config()).primaryHostId;
    }
    return primaryHostId;
  }

  async function resolveSpace(id: string): Promise<ProjectSpace> {
    const cached = projectCache.get(id);
    if (cached && Date.now() - cached.loadedAt < PROJECT_CACHE_MS) {
      return cached.space;
    }
    const project = await bb.sdk.projects.get({ projectId: id });
    const source =
      project.sources.find((candidate) => candidate.isDefault) ??
      project.sources[0];
    if (source === undefined || typeof source.path !== "string") {
      throw new Error(
        `Project ${project.name} has no local checkout, so it has no space.`,
      );
    }
    const checkout = source.path.replace(/\/+$/, "");
    const spaceDir = normalizeSpaceDir((await settings.get()).spaceDir);
    const space: ProjectSpace = {
      projectId: project.id,
      projectName: project.name,
      hostId: source.hostId,
      checkoutPath: checkout,
      spaceDir,
      rootPath: `${checkout}/${spaceDir}`,
      isLocal: source.hostId === (await serverHostId()),
    };
    projectCache.set(id, { space, loadedAt: Date.now() });
    return space;
  }

  async function spaceExists(space: ProjectSpace): Promise<boolean> {
    if (space.isLocal) {
      try {
        return (await stat(space.rootPath)).isDirectory();
      } catch {
        return false;
      }
    }
    return hasSpaceDir(bb, space.hostId, space.checkoutPath, space.spaceDir);
  }

  /** A space file as text, or null when it cannot be read. */
  async function readText(space: ProjectSpace, path: string): Promise<string | null> {
    try {
      const file = await bb.sdk.files.read({
        hostId: space.hostId,
        path: absolute(space, path),
        rootPath: space.rootPath,
      });
      return file.contentEncoding === "utf8"
        ? file.content
        : Buffer.from(file.content, "base64").toString("utf8");
    } catch {
      return null;
    }
  }

  // ── Live change notifications ────────────────────────────────────────────
  // One recursive watcher per local space, started the first time the app
  // touches that project and kept until the plugin unloads.
  const watchers = new Map<string, TreeWatcher>();
  const pendingNotify = new Map<string, ReturnType<typeof setTimeout>>();

  function notifyChanged(projectIdToNotify: string): void {
    const existing = pendingNotify.get(projectIdToNotify);
    if (existing !== undefined) clearTimeout(existing);
    pendingNotify.set(
      projectIdToNotify,
      setTimeout(() => {
        pendingNotify.delete(projectIdToNotify);
        bb.realtime.publish(SPACE_CHANGED, { projectId: projectIdToNotify });
      }, 250),
    );
  }

  function ensureWatcher(space: ProjectSpace): boolean {
    if (!space.isLocal) return false;
    if (watchers.has(space.projectId)) return true;
    try {
      const watcher = watchTree(
        space.rootPath,
        () => notifyChanged(space.projectId),
        (error) => {
          bb.log.warn(`space watcher for ${space.projectId} stopped: ${String(error)}`);
          watchers.delete(space.projectId);
        },
      );
      watchers.set(space.projectId, watcher);
      return true;
    } catch {
      // The directory does not exist yet; space_init starts the watcher.
      return false;
    }
  }

  // A new *Space folder* moves every space: forget the resolved paths, stop
  // the watchers of the old folders and tell open pages to load again.
  settings.onChange((next, prev) => {
    if (normalizeSpaceDir(next.spaceDir) === normalizeSpaceDir(prev.spaceDir)) return;
    const projectIds = new Set([...projectCache.keys(), ...watchers.keys()]);
    projectCache.clear();
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    for (const id of projectIds) notifyChanged(id);
  });

  bb.onDispose(() => {
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    for (const timer of pendingNotify.values()) clearTimeout(timer);
    pendingNotify.clear();
  });

  return { resolveSpace, spaceExists, readText, notifyChanged, ensureWatcher };
}
