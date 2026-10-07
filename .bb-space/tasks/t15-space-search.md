# T15 · Search across the space

Find a page by name or by text inside it.

> [!success] Merged 2026-10-07
> Wave 1 · depends on: T01. Documented now in [Using the space → Find a page](../guides/using-the-space.md#find-a-page) and [For agents → Search output](../guides/for-agents.md#search-output).

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

- [x] Searching `tldraw` in this space finds the decision page by content
      and `diagram.tldr` by label; `roadmap` finds the file by name.
- [x] A 2000-file space answers within the time budget (generate one in a
      temp project, report timings).
- [x] `npm run check` passes.

## Result (2026-10-07)

Timings on a generated space of 2050 files (1800 Markdown pages of ~10 KB,
100 HTML, 50 canvases, 50 PNGs, 50 text files over 1 MB), wall time of
`bb space search` including ~0.25 s of CLI start-up:

| Query | Results | Time |
|---|---|---|
| a word only in the last file (full scan) | 1 text hit | 0.38 s |
| a word in nearly every file | 50, truncated | 0.28 s |
| no match (full scan) | 0 | 0.38–0.48 s |
| `page-44` (names) | 40 names | 0.42 s |

Local spaces read files with Node (`stat` first, so big files are skipped
unread); a space on another machine reads through `bb.sdk.files.read`, which
has no size check before the read. Not measured on a remote host.

## Out of scope

An index or ranking beyond name-before-content.

## Docs

[Using the space](../guides/using-the-space.md) and
[for agents](../guides/for-agents.md) (the CLI command).
