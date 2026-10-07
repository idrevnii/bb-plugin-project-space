# T31 · Review tab and sending annotations to a thread

Collect open annotations and send them to an agent in one message: the bridge
from the full-screen space back to threads.

> [!success] Done 2026-10-07
> Wave 2 · depends on: T10. Documented in [Using the space → Review and send to an agent](../guides/using-the-space.md#review-and-send-to-an-agent)
> and [Annotations → Review and *Send to…*](../architecture/annotations.md#review-and-send-to).

## Read first

- [Annotations decision](../decisions/annotations.md)
- SDK: `useComposers()`, `useBbNavigate().toCompose({ initialPrompt })`,
  `experimental_useSidebarThreads()`, server `bb.sdk.threads.send`

## Do

1. `ui/ReviewTab.tsx`: a fixed tab (`id: "review"`, icon `MessageSquare`)
   listing the project's annotations grouped by file — open first, then
   sent, then resolved — with a count of open ones. Click jumps to the
   annotation (route + scroll).
2. *Send to…* with the open annotations (or a selection of them):
   - **A composer on screen** (`useComposers()`, labelled by scope) — inserts
     the message; the user sends it.
   - **A thread of this project** (picker from the sidebar thread hook) —
     `server/send.ts` RPC `annotations_send({ projectId, ids, threadId })`
     calls `bb.sdk.threads.send`.
   - **New thread** — `toCompose({ initialPrompt })`.
3. Message format (shared function, unit-tested):
   ```
   Review of the project space — 3 comments.
   1. architecture/index.md — «exact quote» → comment  [ann_…]
   …
   Resolve each with `bb space annotations resolve <id> --note "…"` when done.
   ```
4. Sent annotations get `status: "sent"` and `sentTo`.

## Acceptance

- [x] e2e: two annotations → *Send to new thread* prefills the composer with
      the format above; sending to an existing thread posts it there.
- [x] Statuses update in the tab live.
- [x] `npm run check` passes.

## Out of scope

Creating annotations (T30/T33/T34); the agent-side commands (T32).

## Docs

[Using the space](../guides/using-the-space.md) → *Annotations*.
