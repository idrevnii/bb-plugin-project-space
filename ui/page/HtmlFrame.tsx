import { baseName, encodeSpacePath, parentOf } from "../../lib/space";
import type { SpaceFile } from "../../server";
import { Centered } from "./Centered";

/**
 * HTML rendered like a browser page, in a sandbox without same-origin access
 * to bb. Served from the space preview URL so relative assets resolve. While
 * editing, the unsaved draft renders through srcdoc with a <base> pointing at
 * the file's folder.
 */
export function HtmlFrame({
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
