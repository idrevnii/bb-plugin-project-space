import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { fileKind } from "../lib/space";
import { useSpaceFile, useSpaceInfo } from "./data";
import { outlineKey, outlineOf, scrollToHeading, useActiveHeading } from "./outline";
import { Centered } from "./page/Centered";
import { parseRoute } from "./page/routing";

/** The right-panel Outline tab: the open Markdown page's headings. */
export function OutlineTab({ subPath }: { subPath: string }) {
  const route = parseRoute(subPath);
  const { info } = useSpaceInfo(route.projectId);
  const markdown = route.path !== "" && fileKind(route.path) === "markdown";
  const { file, error, missing } = useSpaceFile(
    info?.exists && markdown ? route.projectId : null,
    route.path,
    info?.watching ?? true,
  );
  const key = info === null ? null : outlineKey(info.projectId, route.path);
  const active = useActiveHeading(key);
  const content = file?.path === route.path ? file.content : null;
  const headings = useMemo(() => (content === null ? null : outlineOf(content)), [content]);

  if (route.projectId === null || info === null) {
    return <Centered>Pick a project to see a page's outline.</Centered>;
  }
  if (!info.exists) return <Centered>This project has no space yet.</Centered>;
  if (route.path === "") return <Centered>Open a page to see its outline.</Centered>;
  if (!markdown) return <Centered>No outline for this file.</Centered>;
  if (missing) return <Centered>This page does not exist.</Centered>;
  if (error !== null) return <Centered><span className="text-destructive">{error}</span></Centered>;
  if (headings === null || key === null) return <Centered>Loading…</Centered>;
  if (headings.length === 0) return <Centered>This page has no headings.</Centered>;

  const top = Math.min(...headings.map((heading) => heading.level));
  return (
    <nav aria-label="Outline" className="h-full min-h-0 overflow-y-auto p-2">
      <ul>
        {headings.map((heading, index) => (
          <li key={`${index}-${heading.id}`}>
            <button
              type="button"
              title={heading.text}
              aria-current={heading.id === active ? "location" : undefined}
              onClick={() => scrollToHeading(key, heading.id)}
              className={cn(
                "flex h-7 w-full items-center rounded-md pr-2 text-left text-sm outline-none focus-visible:underline",
                heading.id === active
                  ? "bg-state-active text-foreground"
                  : "text-foreground/80 hover:bg-state-hover hover:text-foreground",
              )}
              style={{ paddingLeft: 8 + (heading.level - top) * 14 }}
            >
              <span className="truncate">{heading.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
