// The Space page: route parsing, project selection, and the document area.
// Route: /plugins/project-space/space/<projectId>/<space-relative path>.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  experimental_SourceCode as SourceCode,
  experimental_useAppPanel,
  useBbContext,
  useBbNavigate,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { SpaceFile, SpaceInfo } from "../../server";
import {
  SPACE_DIR,
  baseName,
  displayName,
  encodeSpacePath,
  fileKind,
  isBinaryKind,
  normalizeSpacePath,
  parentOf,
} from "../../lib/space";
import {
  errorMessage,
  useSpaceFile,
  useSpaceInfo,
  useSpacePreview,
  useSpaceRpc,
  useSpaceTree,
  type SpaceRpc,
} from "../data";
import { FileTree } from "../FileTree";
import { MarkdownView } from "../MarkdownView";
import { TldrawView } from "../TldrawView";

export const PANEL_PATH = "space";
export const FILES_TAB = { panelId: "space", id: "files" } as const;
const LAST_PROJECT_KEY = "project-space:last-project";

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

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

// ── Project picker (no project in the route) ───────────────────────────────

function ProjectPicker() {
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
                onClick={() => go(project.id)}
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

// ── Header switcher (host title bar) ───────────────────────────────────────

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

// ── Document area ──────────────────────────────────────────────────────────

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

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

/** View/edit for text documents (markdown, html, plain text). */
function TextDocument({
  projectId,
  file,
  rpc,
  previewBaseUrl,
  onOpenSpacePath,
  toolbar,
}: {
  projectId: string;
  file: SpaceFile;
  rpc: SpaceRpc;
  previewBaseUrl: string | null;
  onOpenSpacePath: (path: string, hash: string) => void;
  toolbar: (controls: ReactNode) => ReactNode;
}) {
  const kind = fileKind(file.path);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.content);
  /** The version the draft is based on; saves compare-and-swap against it. */
  const [baseSha, setBaseSha] = useState(file.sha256);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  // Follow outside changes while not editing.
  useEffect(() => {
    if (!editing) {
      setDraft(file.content);
      setBaseSha(file.sha256);
    } else if (file.sha256 !== baseSha && draft === file.content) {
      setBaseSha(file.sha256);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const outsideChange = editing && file.sha256 !== baseSha;

  const doSave = useCallback(
    async (force = false) => {
      setSave({ kind: "saving" });
      try {
        const result = await rpc.call("space_write", {
          projectId,
          path: file.path,
          content: draft,
          ...(force ? {} : { expectedSha256: baseSha }),
        });
        if (result.outcome === "written") {
          setBaseSha(result.sha256);
          setSave({ kind: "idle" });
        } else {
          setSave({ kind: "conflict" });
        }
      } catch (cause) {
        setSave({ kind: "error", message: errorMessage(cause) });
      }
    },
    [rpc, projectId, file.path, draft, baseSha],
  );

  const textarea = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (editing) textarea.current?.focus();
  }, [editing]);

  const controls = (
    <>
      {editing ? (
        <>
          <span className="text-xs text-muted-foreground">
            {save.kind === "saving" ? "Saving…" : draft !== file.content || baseSha !== file.sha256 ? "Unsaved" : "Saved"}
          </span>
          <Button size="sm" variant="outline" onClick={() => void doSave()}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setDraft(file.content);
              setBaseSha(file.sha256);
              setSave({ kind: "idle" });
            }}
          >
            Done
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          <Icon name="Edit" className="size-3.5" />
          Edit
        </Button>
      )}
    </>
  );

  const banner =
    save.kind === "conflict" || outsideChange ? (
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-xs">
        <span className="flex-1">This file changed on disk since you started editing.</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft(file.content);
            setBaseSha(file.sha256);
            setSave({ kind: "idle" });
          }}
        >
          Discard mine
        </Button>
        <Button size="sm" variant="outline" onClick={() => void doSave(true)}>
          Overwrite
        </Button>
      </div>
    ) : save.kind === "error" ? (
      <div role="alert" className="border-b border-border px-4 py-2 text-xs text-destructive">
        {save.message}
      </div>
    ) : null;

  const reader =
    kind === "markdown" ? (
      <div className="mx-auto w-full max-w-3xl px-6 py-8 md:px-10">
        <MarkdownView
          content={editing ? draft : file.content}
          path={file.path}
          previewBaseUrl={previewBaseUrl}
          onOpenSpacePath={onOpenSpacePath}
        />
      </div>
    ) : kind === "html" ? (
      <HtmlFrame baseUrl={previewBaseUrl} file={file} />
    ) : (
      <div className="p-4 text-[13px]">
        <SourceCode content={file.content} path={file.path} overflow="wrap" />
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {toolbar(controls)}
      {banner}
      {editing ? (
        <div className={cn("grid min-h-0 flex-1", kind === "markdown" || kind === "html" ? "md:grid-cols-2" : "grid-cols-1")}>
          <textarea
            ref={textarea}
            value={draft}
            spellCheck={kind === "markdown"}
            aria-label={`Edit ${baseName(file.path)}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                void doSave();
              }
            }}
            className="min-h-0 resize-none border-r border-border bg-background p-6 font-mono text-[13px] leading-6 text-foreground outline-none"
          />
          {kind === "markdown" || kind === "html" ? (
            <div className="hidden min-h-0 overflow-y-auto md:block">
              {kind === "html" ? <HtmlFrame baseUrl={previewBaseUrl} file={file} srcDoc={draft} /> : reader}
            </div>
          ) : null}
        </div>
      ) : (
        <div className={cn("min-h-0 flex-1", kind === "html" ? "flex flex-col" : "overflow-y-auto")}>{reader}</div>
      )}
    </div>
  );
}

/**
 * HTML rendered like a browser page, in a sandbox without same-origin access
 * to bb. Served from the space preview URL so relative assets resolve. While
 * editing, the unsaved draft renders through srcdoc with a <base> pointing at
 * the file's folder.
 */
function HtmlFrame({
  baseUrl,
  file,
  srcDoc,
}: {
  baseUrl: string | null;
  file: SpaceFile;
  srcDoc?: string;
}) {
  if (baseUrl === null) {
    return <Centered>Preparing preview…</Centered>;
  }
  const folder = parentOf(file.path);
  const base = `${new URL(baseUrl, window.location.href).href}${folder === "" ? "" : `${encodeSpacePath(folder)}/`}`;
  const sandbox = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";
  if (srcDoc !== undefined) {
    const baseTag = `<base href="${base}">`;
    const head = /<head(\s[^>]*)?>/i;
    const document = /<base\s/i.test(srcDoc)
      ? srcDoc
      : head.test(srcDoc)
        ? srcDoc.replace(head, (match) => match + baseTag)
        : baseTag + srcDoc;
    return (
      <iframe
        title={`${baseName(file.path)} (draft)`}
        sandbox={sandbox}
        srcDoc={document}
        className="h-full min-h-[24rem] w-full flex-1 border-0 bg-white"
      />
    );
  }
  return (
    <iframe
      key={file.sha256}
      title={baseName(file.path)}
      sandbox={sandbox}
      src={`${baseUrl}${encodeSpacePath(file.path)}?v=${file.sha256.slice(0, 12)}`}
      className="h-full min-h-0 w-full flex-1 border-0 bg-white"
    />
  );
}

function BinaryDocument({
  file,
  baseUrl,
  toolbar,
}: {
  file: SpaceFile;
  baseUrl: string | null;
  toolbar: (controls: ReactNode) => ReactNode;
}) {
  const kind = fileKind(file.path);
  const src = baseUrl === null ? null : `${baseUrl}${encodeSpacePath(file.path)}?v=${file.sha256.slice(0, 12)}`;
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {toolbar(null)}
      {src === null ? (
        <Centered>Preparing preview…</Centered>
      ) : kind === "image" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
          <img src={src} alt={baseName(file.path)} className="max-h-full max-w-full rounded-lg border border-border" />
        </div>
      ) : (
        <iframe title={baseName(file.path)} src={src} className="min-h-0 w-full flex-1 border-0" />
      )}
    </div>
  );
}

function pickDefaultFile(paths: string[]): string | null {
  const files = paths.filter((path) => !isBinaryKind(fileKind(path)));
  const preferred = ["index.md", "README.md", "readme.md", "index.html"];
  for (const name of preferred) if (files.includes(name)) return name;
  return files.find((path) => !path.includes("/") && fileKind(path) === "markdown") ??
    files.find((path) => fileKind(path) === "markdown") ??
    files[0] ??
    null;
}

function ProjectSpace({
  info,
  path,
  treePosition,
}: {
  info: SpaceInfo;
  path: string;
  treePosition: "left" | "right";
}) {
  const rpc = useSpaceRpc();
  const go = useSpaceNavigation();
  const { settingsTldrawLicenseKey } = useLicenseKey();
  const previewBaseUrl = useSpacePreview(info.projectId);
  const tree = useSpaceTree(info.projectId, info.watching);
  const appPanel = experimental_useAppPanel();
  const isDirectory = tree.entries?.some((entry) => entry.path === path && entry.kind === "directory") ?? false;
  const filePath = path === "" || isDirectory ? null : path;
  const { file, error, missing } = useSpaceFile(info.projectId, filePath, info.watching);

  // A folder or the root opens its index (or the first readable page).
  useEffect(() => {
    if (filePath !== null || tree.entries === null) return;
    const prefix = path === "" ? "" : `${path}/`;
    const inFolder = tree.entries
      .filter((entry) => entry.kind === "file" && entry.path.startsWith(prefix))
      .map((entry) => entry.path.slice(prefix.length));
    const pick = pickDefaultFile(inFolder);
    if (pick !== null) go(info.projectId, prefix + pick, { replace: true });
  }, [filePath, path, tree.entries, go, info.projectId]);

  const openSpacePath = useCallback(
    (target: string, hash: string) => {
      go(info.projectId, target);
      if (hash !== "") {
        setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }), 300);
      }
    },
    [go, info.projectId],
  );

  const toolbar = (controls: ReactNode) => (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
      <div className="min-w-0 flex-1">
        <Breadcrumbs projectId={info.projectId} projectName={info.projectName} path={filePath ?? path} />
      </div>
      {controls}
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

  let body: ReactNode;
  if (filePath === null) {
    body = (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {toolbar(null)}
        <Centered>
          {tree.entries === null ? "Loading…" : "This folder has no pages yet. Create one from the file tree."}
        </Centered>
      </div>
    );
  } else if (missing) {
    body = (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {toolbar(null)}
        <Centered>
          <p><code>{filePath}</code> does not exist (any more).</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => go(info.projectId)}>
            Go to the space's start page
          </Button>
        </Centered>
      </div>
    );
  } else if (error !== null) {
    body = <Centered><span className="text-destructive">{error}</span></Centered>;
  } else if (file === null || file.path !== filePath) {
    body = (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {toolbar(null)}
        <Centered>Loading…</Centered>
      </div>
    );
  } else if (fileKind(file.path) === "tldraw") {
    body = (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {toolbar(null)}
        <div className="min-h-0 flex-1">
          <TldrawView
            key={`${info.projectId}/${file.path}`}
            projectId={info.projectId}
            file={file}
            rpc={rpc}
            licenseKey={settingsTldrawLicenseKey}
          />
        </div>
      </div>
    );
  } else if (isBinaryKind(fileKind(file.path))) {
    body = <BinaryDocument file={file} baseUrl={previewBaseUrl} toolbar={toolbar} />;
  } else {
    body = (
      <TextDocument
        key={`${info.projectId}/${file.path}`}
        projectId={info.projectId}
        file={file}
        rpc={rpc}
        previewBaseUrl={previewBaseUrl}
        onOpenSpacePath={openSpacePath}
        toolbar={toolbar}
      />
    );
  }

  if (treePosition === "left") {
    return (
      <div className="flex h-full min-h-0 flex-1">
        <aside className="w-64 shrink-0 border-r border-border">
          <FileTree
            projectId={info.projectId}
            projectName={info.projectName}
            entries={tree.entries}
            truncated={tree.truncated}
            error={tree.error}
            activePath={filePath}
            rpc={rpc}
            onOpen={(next) => go(info.projectId, next)}
            onRefresh={tree.refetch}
          />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">{body}</div>
      </div>
    );
  }
  return body;
}

function useLicenseKey() {
  const { values } = useSettings();
  const key = values?.tldrawLicenseKey;
  return { settingsTldrawLicenseKey: typeof key === "string" ? key.trim() : "" };
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
  return <ProjectSpace info={info} path={route.path} treePosition={treePosition} />;
}

/** The right-panel Files tab. */
export function FilesTab({ subPath }: { subPath: string }) {
  const route = parseRoute(subPath);
  const rpc = useSpaceRpc();
  const go = useSpaceNavigation();
  const treePosition = useTreePosition();
  const { info } = useSpaceInfo(route.projectId);
  const tree = useSpaceTree(info?.exists ? route.projectId : null, info?.watching ?? true);
  if (treePosition === "left") {
    return (
      <Centered>
        The file tree is beside the document. Switch it here with the plugin's
        "File tree position" setting.
      </Centered>
    );
  }
  if (route.projectId === null || info === null) {
    return <Centered>Pick a project to see its files.</Centered>;
  }
  if (!info.exists) return <Centered>This project has no space yet.</Centered>;
  return (
    <FileTree
      projectId={info.projectId}
      projectName={info.projectName}
      entries={tree.entries}
      truncated={tree.truncated}
      error={tree.error}
      activePath={route.path === "" ? null : route.path}
      rpc={rpc}
      onOpen={(next) => go(info.projectId, next)}
      onRefresh={tree.refetch}
    />
  );
}
