// Header switcher (host title bar).
import { useEffect, useState } from "react";
import { useSpaceRpc } from "../data";
import { parseRoute, useSpaceNavigation } from "./routing";

export function ProjectSwitcher({ subPath }: { subPath: string }) {
  const rpc = useSpaceRpc();
  const go = useSpaceNavigation();
  const { projectId } = parseRoute(subPath);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    rpc.call("space_projects").then(
      (result) => setProjects(result.projects),
      () => setProjects([]),
    );
  }, [rpc]);
  if (projectId === null || projects.length === 0) return null;
  return (
    <select
      aria-label="Project"
      value={projectId}
      onChange={(event) => go(event.target.value)}
      className="h-7 max-w-[14rem] rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none hover:bg-state-hover focus:ring-1 focus:ring-ring"
    >
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </select>
  );
}
