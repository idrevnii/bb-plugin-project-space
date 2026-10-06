// Project resolution and live change notifications, shared by every module.
//
// Every project gets a space: the `.bb-space/` directory in its default
// checkout. All file I/O goes through `bb.sdk.files` with the project
// source's host, so a project on an enrolled machine works the same as a
// local one. When that host is the server machine, a recursive fs.watch
// publishes `space-changed` so open pages follow agents' writes.
import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { SPACE_DIR, normalizeSpacePath } from "../lib/space";

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
  /** Absolute `.bb-space` path on `hostId`. */
  rootPath: string;
  isLocal: boolean;
}

const PROJECT_CACHE_MS = 30_000;

export function absolute(space: ProjectSpace, path: string): string {
  return path === "" ? space.rootPath : `${space.rootPath}/${path}`;
}

export function checkoutOf(space: ProjectSpace): string {
  return space.rootPath.slice(0, -SPACE_DIR.length - 1);
}

export type Spaces = ReturnType<typeof createSpaces>;

export function createSpaces(bb: BbPluginApi) {
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
    const space: ProjectSpace = {
      projectId: project.id,
      projectName: project.name,
      hostId: source.hostId,
      rootPath: `${checkout}/${SPACE_DIR}`,
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
    // listPaths does not fail for a missing directory, so look for the space
    // from the checkout root instead.
    try {
      const result = await bb.sdk.files.listPaths({
        hostId: space.hostId,
        path: checkoutOf(space),
        query: SPACE_DIR,
        includeFiles: false,
        includeDirectories: true,
        includeHidden: true,
        limit: 50,
      });
      return result.paths.some((entry) => entry.path === SPACE_DIR);
    } catch {
      return false;
    }
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
  const watchers = new Map<string, FSWatcher>();
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
      const watcher = watch(space.rootPath, { recursive: true }, () =>
        notifyChanged(space.projectId),
      );
      watcher.on("error", (error) => {
        bb.log.warn(`space watcher for ${space.projectId} stopped: ${String(error)}`);
        watcher.close();
        watchers.delete(space.projectId);
      });
      watchers.set(space.projectId, watcher);
      return true;
    } catch {
      // The directory does not exist yet; space_init starts the watcher.
      return false;
    }
  }

  bb.onDispose(() => {
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    for (const timer of pendingNotify.values()) clearTimeout(timer);
    pendingNotify.clear();
  });

  return { resolveSpace, spaceExists, readText, notifyChanged, ensureWatcher };
}
