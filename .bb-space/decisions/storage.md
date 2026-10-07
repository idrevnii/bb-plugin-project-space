# Storage in `.bb-space/`

Where a project's space lives decides whether docs stay next to the code they
describe or drift away from it. This is the founding decision of the plugin.

**Decision.** ***A project's space is the `.bb-space/` folder in its default
checkout***, read and written through `bb.sdk.files`.

## Why

The problem this solves is coming back to a project after months and finding
piles of unreadable Markdown. Documentation that lives in the repo is
versioned with the code, survives bb reinstalls, and agents write it with the
file tools they already use — no special API to learn or to fail at. Going
through `bb.sdk.files` with the project's host means a project on an enrolled
machine works the same as a local one.

## Rejected

- **Plugin SQLite, or a bb Docs vault outside the repo** — no history, and the
  docs drift away from the code they describe.
- **A root `docs/` folder** — many repos already have one with other rules; a
  dedicated dot-folder keeps the space's conventions unambiguous.

## Consequences

Threads in worktrees have their own checkout, so they would write a separate
copy of the space. Two things handle that:

- **`bb space root` points at the main checkout**, so an agent in a worktree
  writes where the user is looking and the edit shows at once.
- **The Space page shows worktree copies** when an agent wrote there anyway: a
  toolbar badge ("2 worktrees changed the space") lists each live worktree's
  branch, its threads, and the space files its branch changed since the merge
  base, committed or not, that still differ from the main space by sha256.

| Rule | Value |
| --- | --- |
| changes listed | added, modified, deleted |
| a branch merely behind main | not listed |
| worktrees checked | the 20 most recently active |
| cost without worktrees | one environment listing |
| opening a file | read-only, `?env=<environmentId>` on the route, under a "Viewing branch X — not the main space" banner |

> [!IMPORTANT] Nothing is copied back
> Worktree edits reach the main space only when the branch is merged, or by
> hand. Copying them from the badge is a possible follow-up, not built.

How it looks to the user: [Using the space → Worktrees](../guides/using-the-space.md#worktrees).
