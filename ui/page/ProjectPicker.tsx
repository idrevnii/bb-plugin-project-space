// The page with no project in the route: pick one.
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { SPACE_DIR } from "../../lib/space";
import { errorMessage, useSpaceRpc } from "../data";
import { lastPage } from "./last-place";
import { useSpaceNavigation } from "./routing";

export function ProjectPicker() {
  const rpc = useSpaceRpc();
  const go = useSpaceNavigation();
  const [projects, setProjects] = useState<
    { id: string; name: string; hasSpace: boolean }[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    rpc.call("space_projects").then(
      (result) => setProjects(result.projects),
      (cause) => setError(errorMessage(cause)),
    );
  }, [rpc]);
  const sorted = [...(projects ?? [])].sort(
    (a, b) => Number(b.hasSpace) - Number(a.hasSpace) || a.name.localeCompare(b.name),
  );
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-5">
        <p className="text-sm text-muted-foreground">
          Pick a project. Its space lives in <code>{SPACE_DIR}/</code> in the project's checkout.
        </p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {projects === null && error === null ? (
          <p className="text-sm text-muted-foreground">Loading projects…</p>
        ) : null}
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {sorted.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                onClick={() => go(project.id, lastPage(project.id))}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-state-hover"
              >
                <Icon name={project.hasSpace ? "Layers" : "Folder"} className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <span className="text-xs text-muted-foreground">
                  {project.hasSpace ? "Open" : "No space yet"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
