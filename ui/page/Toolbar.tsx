// The bar above every document: breadcrumbs, the document's controls, and
// the button that opens the Files tab.
import type { ReactNode } from "react";
import { experimental_useAppPanel } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { displayName, fileKind } from "../../lib/space";
import { FILES_TAB, useSpaceNavigation } from "./routing";

function Breadcrumbs({
  projectId,
  projectName,
  path,
}: {
  projectId: string;
  projectName: string;
  path: string;
}) {
  const go = useSpaceNavigation();
  const parts = path.split("/").filter(Boolean);
  return (
    <nav aria-label="Breadcrumbs" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <button type="button" onClick={() => go(projectId)} className="shrink-0 hover:text-foreground">
        {projectName}
      </button>
      {parts.map((part, index) => (
        <span key={index} className="flex min-w-0 items-center gap-1">
          <Icon name="ChevronRight" className="size-3 shrink-0" />
          <span className={cn("truncate", index === parts.length - 1 && "text-foreground")}>
            {index === parts.length - 1 && fileKind(path) === "markdown" ? displayName(part) : part}
          </span>
        </span>
      ))}
    </nav>
  );
}

export function Toolbar({
  projectId,
  projectName,
  path,
  treePosition,
  children,
}: {
  projectId: string;
  projectName: string;
  path: string;
  treePosition: "left" | "right";
  children?: ReactNode;
}) {
  const appPanel = experimental_useAppPanel();
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
      <div className="min-w-0 flex-1">
        <Breadcrumbs projectId={projectId} projectName={projectName} path={path} />
      </div>
      {children}
      {treePosition === "right" ? (
        <Button
          size="sm"
          variant="ghost"
          aria-label="Show files"
          onClick={() => appPanel.openFixedTab({ surface: { kind: "current" }, tab: FILES_TAB })}
        >
          <Icon name="PanelRight" className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
