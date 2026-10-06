// Route: /plugins/project-space/space/<projectId>/<space-relative path>.
import { useCallback } from "react";
import { useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import { encodeSpacePath, normalizeSpacePath } from "../../lib/space";

export const PANEL_PATH = "space";
export const FILES_TAB = { panelId: "space", id: "files" } as const;
export const OUTLINE_TAB = { panelId: "space", id: "outline" } as const;

export interface SpaceRoute {
  projectId: string | null;
  path: string;
}

export function parseRoute(subPath: string): SpaceRoute {
  const segments = subPath.split("/").filter((segment) => segment !== "");
  const decoded = segments.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  const [projectId, ...rest] = decoded;
  return {
    projectId: projectId ?? null,
    path: normalizeSpacePath(rest.join("/")) ?? "",
  };
}

export function routeSubPath(projectId: string, path = ""): string {
  return [encodeURIComponent(projectId), encodeSpacePath(path)]
    .filter((part) => part !== "")
    .join("/");
}

export function useSpaceNavigation() {
  const navigate = useBbNavigate();
  return useCallback(
    (projectId: string, path = "", options: { replace?: boolean } = {}) => {
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: routeSubPath(projectId, path),
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
