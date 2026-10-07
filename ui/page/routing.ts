// Route: /plugins/project-space/space/<projectId>/<space-relative path>,
// plus `?env=<environmentId>` to view a worktree's copy of the file.
import { useCallback } from "react";
import { useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import { encodeSpacePath, normalizeSpacePath } from "../../lib/space";
import { splitEnvQuery } from "../../lib/worktrees";

export const PANEL_PATH = "space";
export const FILES_TAB = { panelId: "space", id: "files" } as const;
export const OUTLINE_TAB = { panelId: "space", id: "outline" } as const;

export interface SpaceRoute {
  projectId: string | null;
  path: string;
  /** A worktree environment whose copy of `path` is shown read-only. */
  env: string | null;
}

export function parseRoute(subPath: string): SpaceRoute {
  const { rest, env } = splitEnvQuery(subPath);
  const segments = rest.split("/").filter((segment) => segment !== "");
  const decoded = segments.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  const [projectId, ...pathSegments] = decoded;
  return {
    projectId: projectId ?? null,
    path: normalizeSpacePath(pathSegments.join("/")) ?? "",
    env,
  };
}

export function routeSubPath(projectId: string, path = "", env: string | null = null): string {
  const subPath = [encodeURIComponent(projectId), encodeSpacePath(path)]
    .filter((part) => part !== "")
    .join("/");
  return env === null ? subPath : `${subPath}?env=${encodeURIComponent(env)}`;
}

export function useSpaceNavigation() {
  const navigate = useBbNavigate();
  return useCallback(
    (projectId: string, path = "", options: { replace?: boolean; env?: string } = {}) => {
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: routeSubPath(projectId, path, options.env ?? null),
        ...(options.replace ? { replace: true } : {}),
      });
    },
    [navigate],
  );
}

export function useTreePosition(): "left" | "right" {
  const { values } = useSettings();
  return values?.treePosition === "left" ? "left" : "right";
}
