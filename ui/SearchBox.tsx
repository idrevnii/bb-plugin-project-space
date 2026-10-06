// Search at the top of the Files tab: a box that asks `space_search` as you
// type (debounced), and the results list that replaces the tree while a
// query is present. Enter or a click opens a result; a Markdown content hit
// then scrolls to the nearest heading above the matched line.
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { displayName, fileKind } from "../lib/space";
import type { SpaceSearchOutput, SpaceSearchResult } from "../server";
import { errorMessage, type SpaceRpc } from "./data";
import { headingAtLine, outlineKey, scrollToHeadingWhenReady } from "./outline";

const DEBOUNCE_MS = 200;

export interface SpaceSearch {
  query: string;
  setQuery: (query: string) => void;
  /** True while a query is typed: the results replace the tree. */
  active: boolean;
  output: SpaceSearchOutput | null;
  pending: boolean;
  error: string | null;
  selected: number;
  setSelected: (index: number) => void;
  open: (result: SpaceSearchResult) => void;
}

export function useSpaceSearch(
  projectId: string,
  rpc: SpaceRpc,
  onOpen: (path: string) => void,
): SpaceSearch {
  const [query, setQueryState] = useState("");
  const [output, setOutput] = useState<SpaceSearchOutput | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const request = useRef(0);
  const trimmed = query.trim();

  useEffect(() => {
    const id = ++request.current;
    if (trimmed === "") {
      setOutput(null);
      setPending(false);
      setError(null);
      return;
    }
    setPending(true);
    const timer = setTimeout(() => {
      rpc.call("space_search", { projectId, query: trimmed }).then(
        (next) => {
          if (id !== request.current) return;
          setOutput(next);
          setSelected(0);
          setError(null);
          setPending(false);
        },
        (cause) => {
          if (id !== request.current) return;
          setError(errorMessage(cause));
          setPending(false);
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rpc, projectId, trimmed]);

  // Another project starts with an empty box.
  useEffect(() => setQueryState(""), [projectId]);

  const open = (result: SpaceSearchResult) => {
    onOpen(result.path);
    if (result.kind !== "content" || result.line === undefined) return;
    if (fileKind(result.path) !== "markdown") return;
    const line = result.line;
    rpc.call("space_read", { projectId, path: result.path }).then(
      (file) => {
        if (file.encoding !== "utf8") return;
        const id = headingAtLine(file.content, line);
        if (id !== null) scrollToHeadingWhenReady(outlineKey(projectId, result.path), id);
      },
      () => undefined,
    );
  };

  return {
    query,
    setQuery: setQueryState,
    active: trimmed !== "",
    output,
    pending,
    error,
    selected,
    setSelected,
    open,
  };
}

export function SearchBox({ search }: { search: SpaceSearch }) {
  const input = useRef<HTMLInputElement | null>(null);
  const results = search.output?.results ?? [];
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (search.query === "") return;
      event.preventDefault();
      event.stopPropagation();
      search.setQuery("");
    } else if (event.key === "Enter") {
      const result = results[search.selected];
      if (result === undefined) return;
      event.preventDefault();
      search.open(result);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      search.setSelected((search.selected + step + results.length) % results.length);
    }
  };
  return (
    <div className="shrink-0 border-b border-border px-2 py-1.5">
      <div className="relative flex items-center">
        <Icon
          name="Search"
          className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground"
        />
        <input
          ref={input}
          type="search"
          role="searchbox"
          aria-label="Search the space"
          placeholder="Search pages and text"
          autoComplete="off"
          spellCheck={false}
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          className="h-7 w-full rounded-md border border-input bg-transparent pl-7 pr-7 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
        />
        {search.query !== "" ? (
          <button
            type="button"
            aria-label="Clear search"
            title="Clear (Esc)"
            onClick={() => {
              search.setQuery("");
              input.current?.focus();
            }}
            className="absolute right-1 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground"
          >
            <Icon name="X" className="size-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A name match shows the title over its path; a text hit, path:line over the snippet. */
function ResultRow({
  result,
  active,
  onSelect,
  onOpen,
}: {
  result: SpaceSearchResult;
  active: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const row = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (active) row.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const title = fileKind(result.path) === "markdown" ? displayName(result.path) : result.path.slice(result.path.lastIndexOf("/") + 1);
  return (
    <button
      ref={row}
      type="button"
      role="option"
      aria-selected={active}
      data-search-kind={result.kind}
      data-search-path={result.path}
      title={result.path}
      onMouseEnter={onSelect}
      onClick={onOpen}
      className={cn(
        "flex w-full min-w-0 flex-col items-start rounded-md px-2 py-1 text-left text-sm outline-none",
        active ? "bg-state-active text-foreground" : "text-foreground/90 hover:bg-state-hover",
      )}
    >
      {result.kind === "name" ? (
        <>
          <span className="w-full truncate">{title}</span>
          <span className="w-full truncate font-mono text-xs text-muted-foreground">{result.path}</span>
        </>
      ) : (
        <>
          <span className="w-full truncate text-xs text-muted-foreground">
            {result.path}
            {result.line === undefined ? "" : `:${result.line}`}
          </span>
          <span className="w-full truncate">{result.snippet}</span>
        </>
      )}
    </button>
  );
}

export function SearchResults({ search }: { search: SpaceSearch }) {
  const results = search.output?.results ?? [];
  const names = results.filter((result) => result.kind === "name").length;
  let body;
  if (search.error !== null) {
    body = <p role="alert" className="px-2 text-xs text-destructive">{search.error}</p>;
  } else if (search.output === null) {
    body = <p className="px-2 text-xs text-muted-foreground">Searching…</p>;
  } else if (results.length === 0) {
    body = (
      <p className="px-2 text-xs text-muted-foreground">
        {search.pending ? "Searching…" : "No matches."}
      </p>
    );
  } else {
    body = (
      <div role="listbox" aria-label="Search results">
        {results.map((result, index) => (
          <div key={`${result.kind}:${result.path}:${result.line ?? ""}:${index}`}>
            {index === 0 && names > 0 ? <SectionLabel>Names</SectionLabel> : null}
            {index === names ? <SectionLabel>Text</SectionLabel> : null}
            <ResultRow
              result={result}
              active={index === search.selected}
              onSelect={() => search.setSelected(index)}
              onOpen={() => search.open(result)}
            />
          </div>
        ))}
        {search.output.truncated ? (
          <p className="px-2 pt-2 text-xs text-muted-foreground">
            More matches not shown; narrow the query.
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div
      aria-busy={search.pending}
      className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2"
    >
      {body}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}
