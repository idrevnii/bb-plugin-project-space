// Markdown reading view: document typography from host theme tokens, code
// blocks through BB's own source viewer, links between space files routed
// inside the space, links to other project files opened in BB's file
// preview, images served from the space preview URL.
import { Children, isValidElement, useMemo } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import {
  UrlLink,
  experimental_FileLink as FileLink,
  experimental_SourceCode as SourceCode,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { encodeSpacePath, resolveDocumentLink, resolveSpaceLink } from "../lib/space";
import { MermaidBlock } from "./MermaidBlock";

export interface MarkdownViewProps {
  content: string;
  /** Space-relative path of this document; relative links resolve from it. */
  path: string;
  previewBaseUrl: string | null;
  onOpenSpacePath: (path: string, hash: string) => void;
  /** The checkout holding the space; links out of the space open there. */
  checkout?: { hostId: string; path: string } | null;
  /** Whether the space has a file; decides where `/path` links point. */
  spaceHas?: (path: string) => boolean;
}

const LINK_CLASSES =
  "text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary";

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  js: "js",
  javascript: "js",
  jsx: "jsx",
  ts: "ts",
  typescript: "ts",
  tsx: "tsx",
  sh: "sh",
  bash: "sh",
  shell: "sh",
  zsh: "sh",
  console: "sh",
  py: "py",
  python: "py",
  rb: "rb",
  ruby: "rb",
  go: "go",
  rust: "rs",
  rs: "rs",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  html: "html",
  css: "css",
  sql: "sql",
  md: "md",
  markdown: "md",
  diff: "diff",
  dockerfile: "Dockerfile",
  java: "java",
  kotlin: "kt",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  cs: "cs",
  php: "php",
  lua: "lua",
  nix: "nix",
  xml: "xml",
};

function codePathFor(language: string | undefined): string {
  if (language === undefined) return "snippet.txt";
  const mapped = LANGUAGE_EXTENSIONS[language.toLowerCase()];
  if (mapped === "Dockerfile") return "Dockerfile";
  return `snippet.${mapped ?? language.toLowerCase()}`;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    return <pre className="my-4 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-[13px]">{children}</pre>;
  }
  const language = /language-([\w+#-]+)/.exec(child.props.className ?? "")?.[1];
  const code = textOf(child.props.children).replace(/\n$/, "");
  if (language?.toLowerCase() === "mermaid") return <MermaidBlock code={code} />;
  return (
    <div className="not-prose my-4 overflow-hidden rounded-lg border border-border bg-card text-[13px]">
      {language ? (
        <div className="border-b border-border px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {language}
        </div>
      ) : null}
      <SourceCode content={code} path={codePathFor(language)} overflow="scroll" />
    </div>
  );
}

function Heading({
  level,
  className,
  ...props
}: ComponentPropsWithoutRef<"h1"> & { level: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const Tag = `h${level}` as const;
  const styles: Record<number, string> = {
    1: "mt-2 mb-6 text-3xl font-semibold tracking-tight",
    2: "mt-10 mb-4 border-b border-border pb-2 text-2xl font-semibold tracking-tight",
    3: "mt-8 mb-3 text-xl font-semibold",
    4: "mt-6 mb-2 text-base font-semibold",
    5: "mt-6 mb-2 text-sm font-semibold",
    6: "mt-6 mb-2 text-sm font-semibold text-muted-foreground",
  };
  return (
    <Tag
      className={cn("group scroll-mt-6 text-foreground", styles[level], className)}
      {...props}
    />
  );
}

export function MarkdownView({
  content,
  path,
  previewBaseUrl,
  onOpenSpacePath,
  checkout,
  spaceHas,
}: MarkdownViewProps) {
  const components = useMemo<Components>(
    () => ({
      h1: (props) => <Heading level={1} {...props} />,
      h2: (props) => <Heading level={2} {...props} />,
      h3: (props) => <Heading level={3} {...props} />,
      h4: (props) => <Heading level={4} {...props} />,
      h5: (props) => <Heading level={5} {...props} />,
      h6: (props) => <Heading level={6} {...props} />,
      p: ({ node: _node, ...props }) => <p className="my-4 leading-7" {...props} />,
      ul: ({ node: _node, className, ...props }) => (
        <ul
          className={cn(
            "my-4 list-disc space-y-1.5 pl-6 marker:text-muted-foreground",
            className?.includes("contains-task-list") && "list-none pl-1",
            className,
          )}
          {...props}
        />
      ),
      ol: ({ node: _node, ...props }) => (
        <ol className="my-4 list-decimal space-y-1.5 pl-6 marker:text-muted-foreground" {...props} />
      ),
      li: ({ node: _node, className, ...props }) => (
        <li
          className={cn(
            "leading-7 [&>ol]:my-1.5 [&>ul]:my-1.5",
            className?.includes("task-list-item") && "list-none [&>input]:mr-2 [&>input]:align-[-2px]",
            className,
          )}
          {...props}
        />
      ),
      blockquote: ({ node: _node, ...props }) => (
        <blockquote
          className="my-5 border-l-2 border-border pl-4 text-muted-foreground [&>p]:my-2"
          {...props}
        />
      ),
      hr: () => <hr className="my-8 border-border" />,
      table: ({ node: _node, ...props }) => (
        <div className="my-5 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm" {...props} />
        </div>
      ),
      thead: ({ node: _node, ...props }) => <thead className="bg-muted/50" {...props} />,
      th: ({ node: _node, ...props }) => (
        <th className="border-b border-border px-3 py-2 text-left font-semibold" {...props} />
      ),
      td: ({ node: _node, ...props }) => (
        <td className="border-b border-border px-3 py-2 align-top [tr:last-child_&]:border-b-0" {...props} />
      ),
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      code: ({ node: _node, className, ...props }) => (
        <code
          className={cn(
            "rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]",
            className,
          )}
          {...props}
        />
      ),
      a: ({ node: _node, href = "", children, ...props }) => {
        const target = resolveDocumentLink(path, href, spaceHas);
        if (target?.kind === "space") {
          return (
            <a
              {...props}
              href={`#${target.path}`}
              className={LINK_CLASSES}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey) return;
                event.preventDefault();
                onOpenSpacePath(target.path, target.hash);
              }}
            >
              {children}
            </a>
          );
        }
        if (target?.kind === "checkout") {
          if (checkout == null || target.path === "") {
            return (
              <span
                className="underline decoration-dotted underline-offset-2"
                title={
                  checkout == null
                    ? `${target.path}: the project checkout is not known yet.`
                    : "Links to the checkout root itself do not open."
                }
              >
                {children}
              </span>
            );
          }
          const { lines } = target;
          return (
            <FileLink
              {...props}
              target={{ kind: "host", hostId: checkout.hostId, path: `${checkout.path}/${target.path}` }}
              location={
                lines === null
                  ? null
                  : lines.kind === "line"
                    ? { kind: "line", line: lines.line, column: null }
                    : lines
              }
              title={target.path + (lines === null ? "" : lines.kind === "line" ? `:${lines.line}` : `:${lines.startLine}-${lines.endLine}`)}
              className={LINK_CLASSES}
            >
              {children}
            </FileLink>
          );
        }
        if (target?.kind === "outside") {
          return (
            <span
              className="underline decoration-dotted underline-offset-2"
              title={`${target.href} points outside the project checkout, so it does not open.`}
            >
              {children}
            </span>
          );
        }
        if (href.startsWith("#")) {
          return (
            <a
              {...props}
              href={href}
              className={LINK_CLASSES}
              onClick={(event) => {
                event.preventDefault();
                document
                  .getElementById(decodeURIComponent(href.slice(1)))
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {children}
            </a>
          );
        }
        return (
          <UrlLink
            href={href}
            className={LINK_CLASSES}
          >
            {children}
          </UrlLink>
        );
      },
      img: ({ node: _node, src = "", alt, ...props }) => {
        const source = typeof src === "string" ? src : "";
        const target = resolveSpaceLink(path, source);
        const resolved =
          target === null
            ? source
            : previewBaseUrl === null
              ? undefined
              : previewBaseUrl + encodeSpacePath(target.path);
        return (
          <img
            {...props}
            src={resolved}
            alt={alt ?? ""}
            loading="lazy"
            className="my-4 max-w-full rounded-lg border border-border"
          />
        );
      },
      input: ({ node: _node, ...props }) => (
        <input {...props} disabled className="size-3.5 accent-current" />
      ),
    }),
    [path, previewBaseUrl, onOpenSpacePath, checkout, spaceHas],
  );

  return (
    <article className="text-[15px] text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
