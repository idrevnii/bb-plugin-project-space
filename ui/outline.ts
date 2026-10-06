// The Outline tab's data: headings parsed from Markdown source with the same
// slugger rehype-slug uses (so ids match the rendered page), and a small
// module-level store, keyed by project + path, through which the open page
// shares the heading at the top of its reader and how to scroll to one.
import { useEffect, useSyncExternalStore } from "react";
import GithubSlugger from "github-slugger";
import type { Heading as MdastHeading, Root } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface OutlineHeading {
  id: string;
  text: string;
  level: number;
}

const parser = unified().use(remarkParse).use(remarkGfm);

/** Headings in document order, with the ids `MarkdownView` gives them. */
export function outlineOf(markdown: string): OutlineHeading[] {
  const slugger = new GithubSlugger();
  const headings: OutlineHeading[] = [];
  const visit = (node: Root | Root["children"][number]) => {
    if (node.type === "heading") {
      // react-markdown drops raw HTML and rehype-slug reads the rendered text,
      // which has no image alt text.
      const text = toString(node as MdastHeading, { includeHtml: false, includeImageAlt: false });
      headings.push({ id: slugger.slug(text), text: text.trim(), level: node.depth });
      return;
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(parser.parse(markdown));
  return headings;
}

interface OutlineEntry {
  active: string | null;
  scrollTo: ((id: string) => void) | null;
}

const entries = new Map<string, OutlineEntry>();
const listeners = new Set<() => void>();

export function outlineKey(projectId: string, path: string): string {
  return `${projectId}\u0000${path}`;
}

function update(key: string, patch: Partial<OutlineEntry>) {
  const previous = entries.get(key) ?? { active: null, scrollTo: null };
  const next = { ...previous, ...patch };
  if (next.active === previous.active && next.scrollTo === previous.scrollTo) return;
  entries.set(key, next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The id of the heading at the top of the open page's reader, if any. */
export function useActiveHeading(key: string | null): string | null {
  return useSyncExternalStore(subscribe, () =>
    key === null ? null : (entries.get(key)?.active ?? null),
  );
}

/** Scrolls the open page to a heading. */
export function scrollToHeading(key: string, id: string) {
  const scrollTo = entries.get(key)?.scrollTo;
  if (scrollTo) scrollTo(id);
  else document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Where, from the top of the reader, a heading counts as "current". */
const LINE = 0.25;

/**
 * Tracks the heading at the top of `scroller` and publishes it under `key`.
 * Pass `null` while there is no reader (editing, other file kinds).
 * `content` re-collects the headings when the document changes.
 */
export function useHeadingTracker(
  key: string,
  scroller: HTMLElement | null,
  content: string,
) {
  useEffect(() => {
    if (scroller === null) return;
    const headings = Array.from(
      scroller.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]"),
    );
    const recompute = () => {
      const box = scroller.getBoundingClientRect();
      const line = box.top + box.height * LINE;
      let active: string | null = headings[0]?.id ?? null;
      // At the very top the page's title is current, however short its intro.
      if (scroller.scrollTop > 0) {
        for (const heading of headings) {
          if (heading.getBoundingClientRect().top > line) break;
          active = heading.id;
        }
      }
      update(key, { active });
    };
    // The root reaches far above the reader and ends at the line, so a
    // heading crossing the line in either direction always fires.
    const observer = new IntersectionObserver(recompute, {
      root: scroller,
      rootMargin: `100000px 0px -${(1 - LINE) * 100}% 0px`,
    });
    for (const heading of headings) observer.observe(heading);
    // Reaching or leaving the very top crosses no line; watch for it apart.
    let atTop = scroller.scrollTop === 0;
    const onScroll = () => {
      if ((scroller.scrollTop === 0) === atTop) return;
      atTop = !atTop;
      recompute();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });

    // A short last section never reaches the line; after a click, keep the
    // clicked heading once the scroll settles.
    let clicked: string | null = null;
    const onScrollEnd = () => {
      const target = headings.find((heading) => heading.id === clicked);
      clicked = null;
      if (target === undefined) return;
      // Still in view: the page could not scroll it any higher.
      const box = scroller.getBoundingClientRect();
      const top = target.getBoundingClientRect().top;
      if (top >= box.top && top < box.bottom) update(key, { active: target.id });
    };
    scroller.addEventListener("scrollend", onScrollEnd);
    const scrollTo = (id: string) => {
      const target = headings.find((heading) => heading.id === id);
      if (target === undefined) return;
      clicked = id;
      update(key, { active: id });
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    update(key, { scrollTo });
    recompute();
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("scrollend", onScrollEnd);
      update(key, { active: null, scrollTo: null });
    };
  }, [key, scroller, content]);
}
