import type { Ref } from "react";
import { baseName, encodeSpacePath, parentOf } from "../../lib/space";
import type { SpaceFile } from "../../server";
import { bridgeScript, injectIntoHead, type BridgeConfig } from "../annotate/html-bridge";
import { Centered } from "./Centered";

/**
 * HTML rendered like a browser page, in a sandbox without same-origin access
 * to bb. Served from the space preview URL so relative assets resolve. While
 * editing, the unsaved draft renders through srcdoc with a <base> pointing at
 * the file's folder. In *Annotate* mode the saved file renders the same way
 * with the annotation bridge injected (ui/annotate/html-bridge.ts); the plain
 * view never gets it.
 */
export function HtmlFrame({
  baseUrl,
  file,
  srcDoc,
  bridge,
  frameRef,
}: {
  baseUrl: string | null;
  file: SpaceFile;
  srcDoc?: string;
  bridge?: BridgeConfig;
  frameRef?: Ref<HTMLIFrameElement>;
}) {
  if (baseUrl === null) {
    return <Centered>Preparing preview…</Centered>;
  }
  const folder = parentOf(file.path);
  const base = `${new URL(baseUrl, window.location.href).href}${folder === "" ? "" : `${encodeSpacePath(folder)}/`}`;
  // Never allow-same-origin: the page must not reach bb.
  const sandbox = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";
  if (srcDoc !== undefined || bridge !== undefined) {
    const document =
      bridge !== undefined ? injectIntoHead(file.content, base, bridgeScript(bridge)) : injectIntoHead(srcDoc!, base);
    return (
      <iframe
        ref={frameRef}
        title={bridge !== undefined ? `${baseName(file.path)} (annotate)` : `${baseName(file.path)} (draft)`}
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
