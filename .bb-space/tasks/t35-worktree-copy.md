# T35 · Copy worktree edits into the main space

The worktree badge lists the space files that a branch changed. This task
lets the user copy these files into the main space from the badge.

> [!success] Merged 2026-10-08
> Later · depends on: T19. Documented in [Storage decision → Consequences](../decisions/storage.md#consequences) and [Use the space → Worktrees](../guides/using-the-space.md#worktrees).

## Read first

- [T19](t19-worktree-awareness.md) and the [storage decision](../decisions/storage.md)
- `server/worktrees.ts`, `ui/page/WorktreeBadge.tsx`, `ui/page/WorktreeDocument.tsx`
- SDK: `bb.sdk.environments.diffFile` reads a file at the merge base

## Do

1. `space_worktrees`: for each listed file, add the sha256 of both sides and
   `mainChanged`. `mainChanged` is true if the main file is different from
   the file at the merge base. It is null if git cannot say.
2. RPC `space_worktree_copy({ projectId, environmentId, files })`. Each file
   has the two shas from the list. Write the worktree file into main with
   compare-and-swap on the main sha. If the worktree deleted the file,
   delete it in main. If one side changed since the list, do not touch the
   file.
3. In the badge: **Copy** for each file, **Copy all** for each branch. A
   file with `mainChanged` not false needs a second click.
4. In the banner of a worktree file: **Copy to main space**. After the copy,
   open the main version.

## Acceptance

- [x] A page that only the branch changed copies with one click, and goes
      away from the badge.
- [x] A page that main also changed is marked, and copies only after the
      second click.
- [x] If one side changed after the list, the copy does not touch the file.
- [x] `npm run check` passes.

## Out of scope

A three-way merge. The reason is in the
[storage decision](../decisions/storage.md#consequences).

## Docs

[Storage decision](../decisions/storage.md), [Use the space → Worktrees](../guides/using-the-space.md#worktrees),
[Architecture](../architecture/index.md), [Develop the plugin](../guides/developing.md).

## Result

- `server/worktrees.ts`: the list has `worktreeSha256`, `mainSha256` and
  `mainChanged`. `mainChanged` uses one `diffFile` call for each listed
  file that existed at the merge base. The new RPC `space_worktree_copy`
  copies one file after the other and returns `copied`, `conflict` or
  `stale` for each file. A delete also removes the comments of the file.
- `lib/worktrees.ts`: `mainChangedSinceBase` and `copySummary`.
- `ui/page/WorktreeBadge.tsx`: **Copy**, **Copy all** or **Copy N safe**,
  the notes "main changed it too" and "main not checked", and **Replace
  main version?** before a risky copy. `ui/page/WorktreeDocument.tsx`:
  **Copy to main space** in the banner.
- Tests: `test/worktrees-rpc.test.ts` (new, 6 tests) and
  `test/worktrees.test.ts` (2 more). `npm run check` passes.
- E2E: `scripts/e2e/worktrees.mjs` has the two copy flows.
  It passed on a temporary worktree: 8 of 8 checks. `smoke.mjs` and
  `console-warnings.mjs` passed too.
- Not checked live: a deleted file (**D**) and **Copy all**. The unit tests
  cover the delete. **Copy all** calls the same RPC with more files.
