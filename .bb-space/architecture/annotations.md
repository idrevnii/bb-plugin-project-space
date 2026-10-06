# Annotations

A comment pinned to a place in a space file that survives edits to that
file. This page is the contract the Review tab, *Send to…*, and the agent
CLI/tool build on. Why annotations exist: [decision](../decisions/annotations.md).

| Piece | Where |
|---|---|
| Model, anchoring (pure, shared by server and app) | `lib/annotations.ts` |
| Storage, RPC, following moves | `server/annotations.ts` |
| Tests | `test/annotations.test.ts`, `test/annotations-store.test.ts` |
| Live check | `scripts/e2e/annotations.mjs` |

## Model

```ts
type Anchor =
  | { kind: "text-quote"; exact: string; prefix: string; suffix: string } // md, html, text
  | { kind: "shapes"; shapeIds: string[] }                                  // tldraw
  | { kind: "file" };                                                       // whole file

interface Annotation {
  id: string;            // "ann_" + 12 base-36 chars
  path: string;          // space-relative file
  anchor: Anchor;
  comment: string;       // 1–4000 chars (MAX_COMMENT_LENGTH)
  status: "open" | "sent" | "resolved";
  author: "user" | "agent";
  createdAt: number; updatedAt: number;   // ms since epoch
  sentTo?: { threadId: string; at: number };
  resolution?: string;   // agent's note when resolving
}
```

New annotations start `open`. Nothing enforces status transitions; the UI
moves `open → sent` when it sends, the agent moves to `resolved`.

## Anchoring text

- `quoteSelector(text, start, end)` → `{ exact, prefix, suffix }`, with 32
  characters (`QUOTE_CONTEXT`) of context on each side, clamped at the ends.
  `text` is whatever the viewer anchors against — the Markdown source, or the
  rendered text for HTML — and must be the same kind when locating.
- `locateQuote(text, selector)` → `{ start, end } | null`:
  1. **Exact.** One occurrence of `exact` wins. Several are ranked by how
     many characters of `prefix` end right before and of `suffix` start
     right after each.
  2. **Fuzzy.** Without an exact hit, an approximate search (edit distance,
     Sellers' algorithm) accepts matches with at most 30 % of `exact`'s
     length in edits; fewest edits wins, then context. Skipped for quotes
     under 8 characters and for very large texts (> 50 M DP cells).
  3. **Null** — the quote is gone; the UI shows the annotation as
     *orphaned* and keeps it.

Shape anchors are resolved by the canvas (missing ids → orphaned); `file`
anchors always resolve.

## Storage

One JSON file per annotated file, inside the space's hidden bookkeeping
folder (not shown in the tree):

```
.bb-space/.space/annotations/<path>.json   →   { "version": 1, "annotations": [ … ] }
```

- Every write is read → modify → `bb.sdk.files.write` with
  `expectedSha256` (null when creating), retried up to 5 times on conflict,
  so concurrent writers (two windows, an agent) never lose each other's
  changes.
- The file's **location is authoritative** for `path`: reads overwrite the
  stored `path` with the one derived from the file name.
- Finding an annotation by id scans the annotation files; fine for the
  hundreds a space holds.
- An empty file (`annotations: []`) is left in place after the last delete;
  it lists as nothing.
- A file that fails to parse makes the calls that touch it fail with a
  message naming the file to fix or delete.

## Following file changes

`space_move` and `space_remove` (`server/files.ts`) call
`followFileChange` after the file operation:

- **Move** (file or folder): every annotation file at or under the old
  path is re-written at the new path (merged with any already there) and the
  old one removed.
- **Remove** (file or folder): annotation files at or under the path are
  deleted.

Failures are logged, not thrown — the file operation already happened.
Changes made outside the app (an agent's `mv`, `git mv`) are not followed;
those annotations stay under the old path and the UI can show them as
belonging to a missing file.

## RPC

All inputs carry `projectId`. Paths are space-relative and may not point
into `.space/`.

| Method | Input | Output |
|---|---|---|
| `annotations_list` | `path?` (all files when omitted) | `{ annotations }`, oldest first |
| `annotations_create` | `path, anchor, comment, author?` (default `"user"`) | `{ annotation }` |
| `annotations_update` | `id, comment?, status?, resolution?, sentTo?` | `{ annotation }` |
| `annotations_delete` | `id` | `{ ok: true }` |

Unknown ids throw `No annotation <id>`. From a shell:

```sh
echo '{"projectId":"'$BB_PROJECT_ID'","path":"index.md","anchor":{"kind":"file"},"comment":"Tighten the intro"}' > /tmp/a.json
bb plugin rpc call project-space annotations_create --input-file /tmp/a.json --json
```

## Realtime

`space-annotations-changed` with `{ projectId, path }` is published after
every write, once per affected file (both old and new path on a move).
Writes also land on disk inside `.bb-space/`, so the watcher's
`space-changed` fires as well; views that only care about annotations should
listen to the specific channel.
