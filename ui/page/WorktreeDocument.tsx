// A worktree's copy of a space file, read-only, under a banner that says it
// is not the main space. Links inside it stay in the same worktree.
import { useCallback } from "react";
import type { ReactNode } from "react";
import { experimental_SourceCode as SourceCode } from "@get-bb/plugin-sdk/app";
import { Tldraw, type Editor } from "tldraw";
import "tldraw/tldraw.css";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { baseName, fileKind } from "../../lib/space";
import type { SpaceFile } from "../../server";
import { NO_USERS } from "../canvas-file";
import { useWorktreeFile } from "../data";
import { MarkdownView } from "../MarkdownView";
import { isTldrawDevelopmentOrigin, loadInto, useHostColorScheme } from "../TldrawView";
import { Centered } from "./Centered";
import { HtmlFrame } from "./HtmlFrame";
import { useSpaceNavigation } from "./routing";

function ReadOnlyCanvas({ file, licenseKey }: { file: SpaceFile; licenseKey: string }) {
  const colorScheme = useHostColorScheme();
  const handleMount = useCallback(
    (editor: Editor) => {
      const error = loadInto(editor, file.content);
      editor.updateInstanceState({ isReadonly: true });
      if (error === null && editor.getCurrentPageShapeIds().size > 0) {
        editor.zoomToFit({ animation: { duration: 0 } });
      }
    },
    [file.content],
  );
  if (!isTldrawDevelopmentOrigin() && licenseKey === "") {
    return <Centered>tldraw needs a license key on this address.</Centered>;
  }
  return (
    <Tldraw
      key={file.sha256}
      onMount={handleMount}
      users={NO_USERS}
      colorScheme={colorScheme}
      {...(licenseKey === "" ? {} : { licenseKey })}
    />
  );
}

export function WorktreeDocument({
  projectId,
  environmentId,
  path,
  previewBaseUrl,
  licenseKey,
  toolbar,
}: {
  projectId: string;
  environmentId: string;
  path: string;
  /** The main space's preview: relative images and assets resolve there. */
  previewBaseUrl: string | null;
  licenseKey: string;
  toolbar: (controls: ReactNode) => ReactNode;
}) {
  const go = useSpaceNavigation();
  const { file, branch, checkout, error } = useWorktreeFile(projectId, environmentId, path);

  const openSpacePath = useCallback(
    (target: string, hash: string) => {
      go(projectId, target, { env: environmentId });
      if (hash !== "") {
        setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }), 300);
      }
    },
    [go, projectId, environmentId],
  );

  const banner = (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs"
    >
      <Icon name="GitBranch" className="size-3.5 shrink-0" />
      <span className="flex-1">
        Viewing branch <code className="font-mono">{branch ?? environmentId}</code> — not the
        main space. Read-only.
      </span>
      <Button size="sm" variant="outline" onClick={() => go(projectId, path)}>
        Open main version
      </Button>
    </div>
  );

  let body: ReactNode;
  if (error !== null) {
    body = <Centered><span className="text-destructive">{error}</span></Centered>;
  } else if (file === null) {
    body = <Centered>Loading…</Centered>;
  } else {
    const kind = fileKind(file.path);
    if (kind === "markdown") {
      body = (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-8 md:px-10">
            <MarkdownView
              content={file.content}
              path={file.path}
              previewBaseUrl={previewBaseUrl}
              onOpenSpacePath={openSpacePath}
              checkout={checkout}
            />
          </div>
        </div>
      );
    } else if (kind === "html") {
      body = (
        <div className="flex min-h-0 flex-1 flex-col">
          <HtmlFrame baseUrl={previewBaseUrl} file={file} srcDoc={file.content} />
        </div>
      );
    } else if (kind === "tldraw") {
      body = (
        <div className="min-h-0 flex-1">
          <ReadOnlyCanvas file={file} licenseKey={licenseKey} />
        </div>
      );
    } else if (kind === "image" && file.encoding === "base64") {
      const mime = file.path.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/*";
      body = (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
          <img
            src={`data:${mime};base64,${file.content}`}
            alt={baseName(file.path)}
            className="max-h-full max-w-full rounded-lg border border-border"
          />
        </div>
      );
    } else if (file.encoding === "utf8") {
      body = (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-[13px]">
          <SourceCode content={file.content} path={file.path} overflow="wrap" />
        </div>
      );
    } else {
      body = <Centered>This file cannot be shown here.</Centered>;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {toolbar(null)}
      {banner}
      {body}
    </div>
  );
}
