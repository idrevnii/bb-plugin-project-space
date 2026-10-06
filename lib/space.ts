// Pure helpers shared by the server and the app: path rules and file kinds.
// No SDK or Node imports, so both bundles can use them.

/** The space directory, relative to the project's checkout root. */
export const SPACE_DIR = ".bb-space";

/** Hidden plugin bookkeeping inside the space (annotations, later). */
export const SPACE_META_DIR = ".space";

export type SpaceFileKind =
  | "markdown"
  | "html"
  | "tldraw"
  | "image"
  | "pdf"
  | "text";

const KIND_BY_EXTENSION: Record<string, SpaceFileKind> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  html: "html",
  htm: "html",
  tldr: "tldraw",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  pdf: "pdf",
};

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function fileKind(path: string): SpaceFileKind {
  return KIND_BY_EXTENSION[extensionOf(path)] ?? "text";
}

/** Kinds whose bytes are read as base64 rather than UTF-8 text. */
export function isBinaryKind(kind: SpaceFileKind): boolean {
  return kind === "image" || kind === "pdf";
}

/**
 * Normalizes a space-relative path: forward slashes, no leading or trailing
 * slash, no empty, `.` or `..` segments. Returns null for anything that could
 * escape the space root. The empty string is the space root itself.
 */
export function normalizeSpacePath(input: string): string | null {
  if (input.includes("\0") || input.includes("\\")) return null;
  const segments = input.split("/").filter((segment) => segment !== "");
  for (const segment of segments) {
    if (segment === "." || segment === "..") return null;
  }
  return segments.join("/");
}

export function joinSpacePath(...parts: string[]): string {
  return parts.filter((part) => part !== "").join("/");
}

export function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Title shown for a file: its name without the extension. */
export function displayName(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * Resolves a link written inside a space document (`./other.md`,
 * `../img/a.png`, `/arch/index.md`) against that document's path.
 * Returns null for external URLs, anchors, and links that leave the space.
 */
export function resolveSpaceLink(
  fromPath: string,
  href: string,
): { path: string; hash: string } | null {
  if (href === "" || href.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null;
  const hashIndex = href.indexOf("#");
  const rawPath = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex + 1);
  const queryIndex = rawPath.indexOf("?");
  let target = queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex);
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  const base = target.startsWith("/") ? [] : parentOf(fromPath).split("/");
  const stack = base.filter((segment) => segment !== "");
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return { path: stack.join("/"), hash };
}

/** One-based lines a `#L40` or `#L40-L52` fragment points at. */
export type LineTarget =
  | { kind: "line"; line: number }
  | { kind: "range"; startLine: number; endLine: number };

/** Reads `L40`, `L40-L52` or `L40-52`; null for any other fragment. */
export function parseLineHash(hash: string): LineTarget | null {
  const match = /^L(\d+)(?:-L?(\d+))?$/i.exec(hash);
  if (match === null) return null;
  const start = Number(match[1]);
  if (start < 1) return null;
  if (match[2] === undefined) return { kind: "line", line: start };
  const end = Number(match[2]);
  if (end < start) return null;
  return end === start
    ? { kind: "line", line: start }
    : { kind: "range", startLine: start, endLine: end };
}

export type DocumentLink =
  /** A file in the space; same result `resolveSpaceLink` gives. */
  | { kind: "space"; path: string; hash: string }
  /** A file elsewhere in the project checkout, relative to its root ("" is the root). */
  | { kind: "checkout"; path: string; lines: LineTarget | null }
  /** A relative link that climbs above the checkout root. */
  | { kind: "outside"; href: string };

/**
 * Resolves a link in a space document the way `resolveSpaceLink` does, and
 * also the links it gives up on: relative paths that climb out of the space
 * land in the project checkout (`../../server/index.ts#L10`), and so does a
 * root-absolute path (`/src/app.ts`) unless the space has that file
 * (`spaceHas`; without it, root-absolute paths stay in the space as before).
 * Returns null for external URLs and same-page anchors.
 */
export function resolveDocumentLink(
  fromPath: string,
  href: string,
  spaceHas?: (path: string) => boolean,
): DocumentLink | null {
  const inSpace = resolveSpaceLink(fromPath, href);
  if (inSpace !== null) {
    const rooted = href.startsWith("/");
    if (!rooted || spaceHas === undefined || spaceHas(inSpace.path)) {
      return { kind: "space", ...inSpace };
    }
    if (inSpace.path === "") return { kind: "space", ...inSpace };
    if (inSpace.path.startsWith(`${SPACE_DIR}/`)) {
      return { kind: "space", path: inSpace.path.slice(SPACE_DIR.length + 1), hash: inSpace.hash };
    }
    return { kind: "checkout", path: inSpace.path, lines: parseLineHash(inSpace.hash) };
  }
  if (href === "" || href.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null;
  const hashIndex = href.indexOf("#");
  const rawPath = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex + 1);
  const queryIndex = rawPath.indexOf("?");
  let target = queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex);
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  // resolveSpaceLink only gives up on relative paths by climbing past the
  // space root, so resolve again from the checkout root.
  const stack = [SPACE_DIR, ...parentOf(fromPath).split("/")].filter(
    (segment) => segment !== "",
  );
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return { kind: "outside", href };
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  if (stack[0] === SPACE_DIR) {
    // Out and back in: `../.bb-space/guides/x.md`.
    return { kind: "space", path: stack.slice(1).join("/"), hash };
  }
  return { kind: "checkout", path: stack.join("/"), lines: parseLineHash(hash) };
}

/** Encodes a space-relative path for appending to a preview `baseUrl`. */
export function encodeSpacePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
