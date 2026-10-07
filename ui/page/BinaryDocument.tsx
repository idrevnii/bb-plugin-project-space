// Images and other binary files, served from the space preview URL. A file
// that should be text but is not UTF-8 arrives base64-encoded; it gets a
// notice, never its base64 as text (an edit would save that over the file).
import type { ReactNode } from "react";
import { baseName, encodeSpacePath, fileKind, isBinaryKind } from "../../lib/space";
import type { SpaceFile } from "../../server";
import { Centered } from "./Centered";

export function BinaryDocument({
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
      {!isBinaryKind(kind) ? (
        <Centered>
          <p className="text-base font-medium text-foreground">{baseName(file.path)} is not UTF-8 text</p>
          <p className="mt-2">
            It holds {file.sizeBytes.toLocaleString()} bytes the space cannot show or edit as text.
            Open it with a tool that knows its encoding.
          </p>
        </Centered>
      ) : src === null ? (
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
