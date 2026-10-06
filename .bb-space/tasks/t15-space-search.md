# T15 · Search across the space

**Wave 1 · depends on: T01**

## Goal

Find a page by name or by text inside it.

## Read first

- `server/files.ts`, `ui/FileTree.tsx`, `lib/space.ts`

## Do

1. `server/search.ts`: RPC `space_search({ projectId, query, limit? })` →
   `{ results: [{ path, kind: "name" | "content", line?, snippet? }], truncated }`.
   Name matches first (fuzzy, via `bb.sdk.files.list` with `query`), then
   content matches: read text files (`.md`, `.html`, `.txt`, …; skip binary
   and files > 1 MB), case-insensitive substring, at most 3 hits per file,
   overall limit 50, hard time budget ~2 s. `.tldr` files: search node labels
   via `lib/canvas/read.ts → plainText`.
2. `ui/SearchBox.tsx` at the top of the Files tab (debounced 200 ms, Esc
   clears). Results replace the tree while a query is present; Enter / click
   opens the file; Markdown content hits scroll to the nearest heading above
   the matched line.
3. `bb space search <query>` CLI command, same output, for agents.

## Acceptance

- [ ] Searching `tldraw` in this space finds the decision page by content
      and `diagram.tldr` by label; `roadmap` finds the file by name.
- [ ] A 2000-file space answers within the time budget (generate one in a
      temp project, report timings).
- [ ] `npm run check` passes.

## Out of scope

An index or ranking beyond name-before-content.

## Docs

[Using the space](../guides/using-the-space.md) and
[for agents](../guides/for-agents.md) (the CLI command).
