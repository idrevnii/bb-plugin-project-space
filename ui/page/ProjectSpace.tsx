// A project's space: picks the document for the route and lays it out with
// the toolbar and, when the tree sits on the left, the file tree.
import { useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { useSettings } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { fileKind, isBinaryKind } from "../../lib/space";
import type { SpaceInfo } from "../../server";
import { useSpaceFile, useSpacePreview, useSpaceRpc, useSpaceTree } from "../data";
import { FileTree } from "../FileTree";
import { TldrawView } from "../TldrawView";
import { BinaryDocument } from "./BinaryDocument";
import { Centered } from "./Centered";
import { TextDocument } from "./TextDocument";
import { Toolbar } from "./Toolbar";
import { useSpaceNavigation } from "./routing";

function pickDefaultFile(paths: string[]): string | null {
  const files = paths.filter((path) => !isBinaryKind(fileKind(path)));
  const preferred = ["index.md", "README.md", "readme.md", "index.html"];
  for (const name of preferred) if (files.includes(name)) return name;
  return files.find((path) => !path.includes("/") && fileKind(path) === "markdown") ??
    files.find((path) => fileKind(path) === "markdown") ??
    files[0] ??
    null;
}

export function ProjectSpace({
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
    <Toolbar
      projectId={info.projectId}
      projectName={info.projectName}
      path={filePath ?? path}
      treePosition={treePosition}
    >
      {controls}
    </Toolbar>
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
