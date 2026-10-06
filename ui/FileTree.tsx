// The space's file tree: folders and files with create, rename, and delete.
// Rendered in the page's right panel (default) or beside the document.
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { SpaceTreeEntry } from "../server";
import {
  baseName,
  displayName,
  extensionOf,
  fileKind,
  joinSpacePath,
  normalizeSpacePath,
  parentOf,
  type SpaceFileKind,
} from "../lib/space";
import { errorMessage, type SpaceRpc } from "./data";

interface TreeNode {
  path: string;
  name: string;
  kind: "file" | "directory";
  children: TreeNode[];
}

function buildTree(entries: SpaceTreeEntry[]): TreeNode[] {
  const root: TreeNode = { path: "", name: "", kind: "directory", children: [] };
  const byPath = new Map<string, TreeNode>([["", root]]);
  const ensureDir = (path: string): TreeNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const node: TreeNode = { path, name: baseName(path), kind: "directory", children: [] };
    byPath.set(path, node);
    ensureDir(parentOf(path)).children.push(node);
    return node;
  };
  for (const entry of entries) {
    if (entry.kind === "directory") ensureDir(entry.path);
    else {
      ensureDir(parentOf(entry.path)).children.push({
        path: entry.path,
        name: baseName(entry.path),
        kind: "file",
        children: [],
      });
    }
  }
  const sort = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      // index.* first, then alphabetical.
      const aIndex = displayName(a.name).toLowerCase() === "index";
      const bIndex = displayName(b.name).toLowerCase() === "index";
      if (aIndex !== bIndex) return aIndex ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    node.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

const KIND_ICON: Record<SpaceFileKind, string> = {
  markdown: "FileText",
  html: "Globe",
  tldraw: "Palette",
  image: "File",
  pdf: "FileText",
  text: "File",
};

type NewKind = "markdown" | "tldraw" | "html" | "folder";

const NEW_KIND_LABEL: Record<NewKind, string> = {
  markdown: "Page",
  tldraw: "Canvas",
  html: "HTML",
  folder: "Folder",
};

const NEW_KIND_EXTENSION: Record<Exclude<NewKind, "folder">, string> = {
  markdown: "md",
  tldraw: "tldr",
  html: "html",
};

function starterContent(kind: Exclude<NewKind, "folder">, name: string): string {
  const title = displayName(name);
  if (kind === "markdown") return `# ${title}\n\n`;
  if (kind === "html") {
    return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${title}</title>\n</head>\n<body>\n<h1>${title}</h1>\n</body>\n</html>\n`;
  }
  // An empty .tldr opens as a blank board; the first edit writes the format.
  return "";
}

function expandedKey(projectId: string) {
  return `project-space:expanded:${projectId}`;
}

function useExpanded(projectId: string, activePath: string | null) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(expandedKey(projectId));
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    localStorage.setItem(expandedKey(projectId), JSON.stringify([...expanded]));
  }, [projectId, expanded]);
  // Reveal the open file.
  useEffect(() => {
    if (activePath === null) return;
    const parents: string[] = [];
    for (let dir = parentOf(activePath); dir !== ""; dir = parentOf(dir)) parents.push(dir);
    if (parents.every((dir) => expanded.has(dir))) return;
    setExpanded((previous) => new Set([...previous, ...parents]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);
  const toggle = (path: string, open?: boolean) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (open ?? !next.has(path)) next.add(path);
      else next.delete(path);
      return next;
    });
  return { expanded, toggle };
}

function NameInput({
  initial,
  placeholder,
  depth,
  icon,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  depth: number;
  icon: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const element = input.current;
    if (element === null) return;
    element.focus();
    const dot = initial.lastIndexOf(".");
    element.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = value.trim();
    if (trimmed === "") onCancel();
    else onSubmit(trimmed);
  };
  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-1.5 py-0.5 pr-2"
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <Icon name={icon} className="size-4 shrink-0 text-muted-foreground" />
      <input
        ref={input}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => submit()}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === "Escape") onCancel();
        }}
        className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
    </form>
  );
}

type Draft =
  | { mode: "create"; parent: string; kind: NewKind }
  | { mode: "rename"; path: string };

function Row({
  depth,
  active,
  icon,
  label,
  title,
  onClick,
  actions,
  chevron,
}: {
  depth: number;
  active: boolean;
  icon: string;
  label: string;
  title: string;
  onClick: () => void;
  actions: ReactNode;
  chevron?: "open" | "closed";
}) {
  return (
    <div
      className={cn(
        "group flex h-7 items-center gap-1.5 rounded-md pr-1 text-sm",
        active ? "bg-state-active text-foreground" : "text-foreground/90 hover:bg-state-hover",
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <button
        type="button"
        title={title}
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:underline"
      >
        {chevron === undefined ? (
          <span className="w-3 shrink-0" />
        ) : (
          <Icon
            name={chevron === "open" ? "ChevronDown" : "ChevronRight"}
            className="size-3 shrink-0 text-muted-foreground"
          />
        )}
        <Icon name={icon} className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </button>
      <div className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
        {actions}
      </div>
    </div>
  );
}

function RowAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground"
    >
      <Icon name={icon} className="size-3.5" />
    </button>
  );
}

export function FileTree({
  projectId,
  projectName,
  entries,
  truncated,
  error,
  activePath,
  rpc,
  onOpen,
  onRefresh,
}: {
  projectId: string;
  projectName: string;
  entries: SpaceTreeEntry[] | null;
  truncated: boolean;
  error: string | null;
  activePath: string | null;
  rpc: SpaceRpc;
  onOpen: (path: string) => void;
  onRefresh: () => void;
}) {
  const nodes = useMemo(() => buildTree(entries ?? []), [entries]);
  const { expanded, toggle } = useExpanded(projectId, activePath);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const exists = (path: string) => entries?.some((entry) => entry.path === path) ?? false;

  const create = async (parent: string, kind: NewKind, rawName: string) => {
    setDraft(null);
    let name = rawName.replace(/\/+$/, "");
    if (kind !== "folder" && extensionOf(name) === "") {
      name = `${name}.${NEW_KIND_EXTENSION[kind]}`;
    }
    const path = normalizeSpacePath(joinSpacePath(parent, name));
    if (path === null || path === "") {
      toast.error(`"${rawName}" is not a valid name`);
      return;
    }
    if (exists(path)) {
      toast.error(`${path} already exists`);
      return;
    }
    try {
      if (kind === "folder") {
        await rpc.call("space_mkdir", { projectId, path });
        toggle(path, true);
      } else {
        const fileKindToCreate = fileKind(path);
        const starterKind =
          fileKindToCreate === "markdown" || fileKindToCreate === "html" || fileKindToCreate === "tldraw"
            ? fileKindToCreate
            : kind;
        await rpc.call("space_write", {
          projectId,
          path,
          content: starterContent(starterKind, baseName(path)),
          expectedSha256: null,
        });
        onOpen(path);
      }
      onRefresh();
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  const rename = async (from: string, rawName: string) => {
    setDraft(null);
    const to = normalizeSpacePath(joinSpacePath(parentOf(from), rawName));
    if (to === null || to === "" || to === from) return;
    if (exists(to)) {
      toast.error(`${to} already exists`);
      return;
    }
    try {
      await rpc.call("space_move", { projectId, from, to });
      if (activePath !== null && (activePath === from || activePath.startsWith(`${from}/`))) {
        onOpen(to + activePath.slice(from.length));
      }
      onRefresh();
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  const remove = async (path: string, kind: "file" | "directory") => {
    const what = kind === "directory" ? `the folder "${path}" and everything in it` : `"${path}"`;
    if (!window.confirm(`Delete ${what}?`)) return;
    try {
      await rpc.call("space_remove", { projectId, path });
      onRefresh();
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  const startCreate = (parent: string, kind: NewKind) => {
    if (parent !== "") toggle(parent, true);
    setDraft({ mode: "create", parent, kind });
    setMenuOpen(false);
  };

  const createDraftRow = (parent: string, depth: number) =>
    draft?.mode === "create" && draft.parent === parent ? (
      <NameInput
        initial=""
        depth={depth}
        icon={draft.kind === "folder" ? "Folder" : KIND_ICON[draft.kind]}
        placeholder={`New ${NEW_KIND_LABEL[draft.kind].toLowerCase()} name`}
        onCancel={() => setDraft(null)}
        onSubmit={(value) => void create(parent, draft.kind, value)}
      />
    ) : null;

  const renderNodes = (list: TreeNode[], depth: number): ReactNode =>
    list.map((node) => {
      if (draft?.mode === "rename" && draft.path === node.path) {
        return (
          <NameInput
            key={node.path}
            initial={node.name}
            depth={depth}
            icon={node.kind === "directory" ? "Folder" : KIND_ICON[fileKind(node.path)]}
            placeholder="New name"
            onCancel={() => setDraft(null)}
            onSubmit={(value) => void rename(node.path, value)}
          />
        );
      }
      if (node.kind === "directory") {
        const open = expanded.has(node.path);
        return (
          <div key={node.path}>
            <Row
              depth={depth}
              active={false}
              chevron={open ? "open" : "closed"}
              icon={open ? "FolderOpen" : "Folder"}
              label={node.name}
              title={node.path}
              onClick={() => toggle(node.path)}
              actions={
                <>
                  <RowAction icon="Plus" label={`New page in ${node.name}`} onClick={() => startCreate(node.path, "markdown")} />
                  <RowAction icon="Edit" label={`Rename ${node.name}`} onClick={() => setDraft({ mode: "rename", path: node.path })} />
                  <RowAction icon="Trash2" label={`Delete ${node.name}`} onClick={() => void remove(node.path, "directory")} />
                </>
              }
            />
            {open ? (
              <>
                {createDraftRow(node.path, depth + 1)}
                {renderNodes(node.children, depth + 1)}
              </>
            ) : null}
          </div>
        );
      }
      return (
        <Row
          key={node.path}
          depth={depth}
          active={node.path === activePath}
          icon={KIND_ICON[fileKind(node.path)]}
          label={fileKind(node.path) === "markdown" ? displayName(node.name) : node.name}
          title={node.path}
          onClick={() => onOpen(node.path)}
          actions={
            <>
              <RowAction icon="Edit" label={`Rename ${node.name}`} onClick={() => setDraft({ mode: "rename", path: node.path })} />
              <RowAction icon="Trash2" label={`Delete ${node.name}`} onClick={() => void remove(node.path, "file")} />
            </>
          }
        />
      );
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {projectName}
        </span>
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="New…"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name="Plus" className="size-4" />
          </Button>
          {menuOpen ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div
                role="menu"
                className="absolute right-0 top-8 z-50 w-40 overflow-hidden rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg"
              >
                {(["markdown", "tldraw", "html", "folder"] as const).map((kind) => (
                  <button
                    key={kind}
                    role="menuitem"
                    type="button"
                    onClick={() => startCreate("", kind)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-state-hover"
                  >
                    <Icon
                      name={kind === "folder" ? "FolderPlus" : KIND_ICON[kind]}
                      className="size-4 text-muted-foreground"
                    />
                    {NEW_KIND_LABEL[kind]}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Refresh"
          onClick={onRefresh}
        >
          <Icon name="ArrowReloadHorizontal" className="size-3.5" />
        </Button>
      </div>
      <nav aria-label="Space files" className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {error !== null ? (
          <p role="alert" className="px-2 text-xs text-destructive">{error}</p>
        ) : entries === null ? (
          <p className="px-2 text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            {createDraftRow("", 0)}
            {renderNodes(nodes, 0)}
            {nodes.length === 0 && draft === null ? (
              <p className="px-2 text-xs text-muted-foreground">No files yet.</p>
            ) : null}
            {truncated ? (
              <p className="px-2 pt-2 text-xs text-muted-foreground">Showing the first 5000 entries.</p>
            ) : null}
          </>
        )}
      </nav>
    </div>
  );
}
