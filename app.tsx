// Project Space — frontend entry. Registers the full-screen Space page, its
// Files and Outline tabs in the host's right panel, an "Open space" button in
// thread headers, and the ::space chat directive agents use to point at a page.
import { definePluginApp, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { displayName, normalizeSpacePath } from "./lib/space";
import { registerHeadlessRenderer } from "./ui/headless";
import { OutlineTab } from "./ui/OutlineTab";
import { FilesTab } from "./ui/page/FilesTab";
import { ProjectSwitcher } from "./ui/page/ProjectSwitcher";
import { FILES_TAB, OUTLINE_TAB, PANEL_PATH, routeSubPath } from "./ui/page/routing";
import { SpacePage } from "./ui/page/SpacePage";

function OpenSpaceHeaderAction({
  projectId,
  isCompactViewport,
}: {
  projectId: string;
  isCompactViewport: boolean;
}) {
  const navigate = useBbNavigate();
  return (
    <Button
      variant="ghost"
      size={isCompactViewport ? "icon" : "sm"}
      className={isCompactViewport ? "size-7" : "h-7 gap-1.5 px-2"}
      aria-label="Open project space"
      onClick={() => navigate.toPluginPanel(PANEL_PATH, { subPath: routeSubPath(projectId) })}
    >
      <Icon name="Layers" className="size-4" />
      {isCompactViewport ? null : <span className="text-xs">Space</span>}
    </Button>
  );
}

function SpaceDirective({
  attributes,
}: {
  attributes: Readonly<Record<string, string>>;
}) {
  const navigate = useBbNavigate();
  const projectId = attributes.project?.trim() ?? "";
  const path = normalizeSpacePath(attributes.path ?? "");
  if (projectId === "" || path === null || path === "") {
    return (
      <div className="my-2 text-xs text-muted-foreground">
        A space link without a project or path.
      </div>
    );
  }
  const title = attributes.title?.trim().slice(0, 120) || displayName(path);
  return (
    <div className="my-2 flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <Icon name="Layers" className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">{path}</div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          navigate.toPluginPanel(PANEL_PATH, { subPath: routeSubPath(projectId, path) })
        }
      >
        Open in space
      </Button>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: FILES_TAB.panelId,
    title: "Space",
    icon: "Layers",
    path: PANEL_PATH,
    component: SpacePage,
    headerContent: ProjectSwitcher,
    fixedTabs: [
      {
        ...FILES_TAB,
        title: "Files",
        icon: "PanelRight",
        component: FilesTab,
        layout: "flush",
      },
      {
        ...OUTLINE_TAB,
        title: "Outline",
        icon: "ListView",
        component: OutlineTab,
        layout: "flush",
      },
    ],
  });
  app.slots.experimental_threadHeaderAction({
    id: "open-space",
    title: "Project space",
    component: OpenSpaceHeaderAction,
  });
  app.slots.messageDirective({ id: "space", component: SpaceDirective });
  registerHeadlessRenderer(app);
});
