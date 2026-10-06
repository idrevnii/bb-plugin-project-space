# T19 · Worktree awareness

**Wave 1 · depends on: T01**

## Goal

The Space page shows the main checkout. When threads in worktrees have
changed their own `.bb-space/`, say so, so nothing written there is lost.

## Read first

- [Storage decision](../decisions/storage.md) (the worktree consequence)
- `server/space.ts`; SDK `bb.sdk.environments.list` / `threads.list`

## Do

1. `server/worktrees.ts`: RPC `space_worktrees({ projectId })` → for each
   live worktree environment of the project, the space files that differ
   from the main checkout (added / modified / deleted, by sha256), with the
   environment's branch and its threads' titles. Bounded: at most 20
   environments, skip a worktree whose `.bb-space` is missing.
2. `ui/page/WorktreeBadge.tsx` in the page toolbar: "2 worktrees changed the
   space" → popover listing branches, files and threads, each file openable
   read-only from that worktree (a `?env=<id>` query on the route; banner
   "Viewing branch X — not the main space").
3. No merging or copying in this task.

## Acceptance

- [ ] With a worktree thread that edited `.bb-space/roadmap.md`, the badge
      appears, lists it, and opens the worktree version read-only.
- [ ] No badge and no extra cost when the project has no worktrees.
- [ ] `npm run check` passes.

## Out of scope

Copying worktree changes into the main space (a follow-up).

## Docs

Update [storage decision](../decisions/storage.md) → *Consequence*.
