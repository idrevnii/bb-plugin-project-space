// The Space page: picks a project, offers to create its space, and hands
// the rest to ProjectSpace.
import { useEffect, useState } from "react";
import { useBbContext, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { SPACE_DIR } from "../../lib/space";
import type { SpaceInfo } from "../../server";
import { errorMessage, useSpaceInfo, useSpaceRpc } from "../data";
import { Centered } from "./Centered";
import { ProjectPicker } from "./ProjectPicker";
import { ProjectSpace } from "./ProjectSpace";
import { PANEL_PATH, parseRoute, useSpaceNavigation, useTreePosition } from "./routing";

const LAST_PROJECT_KEY = "project-space:last-project";

function rememberProject(projectId: string) {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, projectId);
  } catch {
    // Storage can be unavailable; the picker still works.
  }
}

function forgetProject() {
  try {
    localStorage.removeItem(LAST_PROJECT_KEY);
  } catch {
    // Nothing to forget.
  }
}

function lastProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

function EmptySpace({ info, onCreated }: { info: SpaceInfo; onCreated: () => void }) {
  const rpc = useSpaceRpc();
  const go = useSpaceNavigation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Centered>
      <Icon name="Layers" className="mx-auto mb-3 size-8 text-muted-foreground" />
      <p className="text-base font-medium text-foreground">{info.projectName} has no space yet</p>
      <p className="mt-2">
        A space is a <code>{SPACE_DIR}/</code> folder in the project with pages, HTML
        reports, and canvases. Agents can fill it with <code>bb space root</code>.
      </p>
      <Button
        className="mt-4"
        disabled={pending}
        onClick={() => {
          setPending(true);
          rpc.call("space_init", { projectId: info.projectId }).then(
            (result) => {
              onCreated();
              go(info.projectId, result.indexPath, { replace: true });
            },
            (cause) => {
              setPending(false);
              setError(errorMessage(cause));
            },
          );
        }}
      >
        Create space
      </Button>
      {error ? <p role="alert" className="mt-3 text-destructive">{error}</p> : null}
    </Centered>
  );
}

/** A hand-written link may carry `?env=` as a real query string. */
function envFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get("env");
}

export function SpacePage({ subPath }: { subPath: string }) {
  const route = parseRoute(subPath);
  const context = useBbContext();
  const go = useSpaceNavigation();
  const navigate = useBbNavigate();
  const treePosition = useTreePosition();

  // No project in the route: continue where the user was, or ask.
  const fallbackProject = route.projectId === null ? (context.projectId ?? lastProject()) : null;
  useEffect(() => {
    if (fallbackProject !== null) go(fallbackProject, "", { replace: true });
  }, [fallbackProject, go]);
  useEffect(() => {
    if (route.projectId !== null) rememberProject(route.projectId);
  }, [route.projectId]);

  const { info, error, refetch } = useSpaceInfo(route.projectId);

  if (route.projectId === null) {
    return fallbackProject === null ? <ProjectPicker /> : null;
  }
  if (error !== null) {
    return (
      <Centered>
        <p className="text-destructive">{error}</p>
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          onClick={() => {
            forgetProject();
            navigate.toPluginPanel(PANEL_PATH, { subPath: "" });
          }}
        >
          Pick another project
        </Button>
      </Centered>
    );
  }
  if (info === null || info.projectId !== route.projectId) return <Centered>Loading…</Centered>;
  if (!info.exists) return <EmptySpace info={info} onCreated={refetch} />;
  return <ProjectSpace info={info} path={route.path} env={route.env ?? envFromLocation()} treePosition={treePosition} />;
}
