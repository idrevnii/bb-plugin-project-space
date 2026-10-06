# T10 · Annotations: model, anchoring, storage, RPC

**Wave 1 · depends on: T01 · blocks: T30–T34**

## Goal

The data layer for annotations, with no UI: a comment pinned to a place in a
space file that survives edits to that file. Every wave-2 task builds on the
contract defined here, so get the types right and document them.

## Read first

- [Annotations decision](../decisions/annotations.md)
- `lib/space.ts`, `server/files.ts` (after T01)

## Model (`lib/annotations.ts`, no SDK imports)

```ts
type Anchor =
  | { kind: "text-quote"; exact: string; prefix: string; suffix: string } // md, html, text
  | { kind: "shapes"; shapeIds: string[] }                                  // tldraw
  | { kind: "file" };                                                       // whole file
interface Annotation {
  id: string;            // "ann_" + random
  path: string;          // space-relative file
  anchor: Anchor;
  comment: string;       // ≤ 4000 chars
  status: "open" | "sent" | "resolved";
  author: "user" | "agent";
  createdAt: number; updatedAt: number;
  sentTo?: { threadId: string; at: number };
  resolution?: string;   // agent's note when resolving
}
```

Pure functions with unit tests:
- `quoteSelector(text, start, end)` → `{ exact, prefix, suffix }` (32 chars
  of context each side).
- `locateQuote(text, selector)` → `{ start, end } | null`: exact match
  disambiguated by prefix/suffix; falls back to the best fuzzy match when the
  text moved; null when it is gone (the UI shows it as *orphaned*).

## Storage and RPC (`server/annotations.ts`)

- One JSON file per annotated file: `.bb-space/.space/annotations/<path>.json`
  (`{ version: 1, annotations: Annotation[] }`), written with
  compare-and-swap through `bb.sdk.files`. Hidden from the tree already
  (dot-folder).
- RPC: `annotations_list({ projectId, path? })`,
  `annotations_create({ projectId, path, anchor, comment })`,
  `annotations_update({ projectId, id, comment?, status?, resolution?, sentTo? })`,
  `annotations_delete({ projectId, id })`.
- Realtime `space-annotations-changed` `{ projectId, path }` after every write.
- Moving or deleting a file in `server/files.ts` moves or deletes its
  annotation file too.

## Acceptance

- [ ] Unit tests for `quoteSelector` / `locateQuote`: unchanged text, text
      inserted before the quote, quote edited slightly, quote removed,
      repeated quote disambiguated by context.
- [ ] RPC round trip via `bb plugin rpc call project-space annotations_*`
      (documented in your report) creates, lists, updates, deletes.
- [ ] Renaming a file in the tree keeps its annotations.
- [ ] `npm run check` passes.

## Out of scope

Any UI, CLI or agent tool (T30–T34).

## Docs

Rewrite [decisions/annotations.md](../decisions/annotations.md) status to
*accepted* and add `architecture/annotations.md` describing the model and
storage.
