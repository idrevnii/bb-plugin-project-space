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

/** Encodes a space-relative path for appending to a preview `baseUrl`. */
export function encodeSpacePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
