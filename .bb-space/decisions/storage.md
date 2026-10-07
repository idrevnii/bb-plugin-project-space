# Storage in `.bb-space/`

**Decision.** A project's space is the `.bb-space/` folder in its default
checkout, read and written through `bb.sdk.files`.

**Why.** The problem this solves is coming back to a project after months and
finding piles of unreadable Markdown. Documentation that lives in the repo is
versioned with the code, survives bb reinstalls, and agents can write it with
the file tools they already use — no special API to learn or fail at.

**Rejected.**
- *Plugin SQLite / bb Docs vault outside the repo* — no history, and the docs
  drift away from the code they describe.
- *Root `docs/` folder* — many repos already have one with other rules; a
  dedicated dot-folder keeps the space's conventions unambiguous.

**Consequence.** Threads in worktrees would write a separate copy. `bb space
root` points agents at the main checkout so edits are visible immediately.
When a worktree thread writes its own `.bb-space/` anyway, the Space page
says so instead of losing it: a toolbar badge ("2 worktrees changed the
space") lists each live worktree's branch, its threads, and the space files
its branch changed (git's diff since the merge base, committed or not) that
still differ from the main space by sha256 — added, modified, or deleted. A
branch that is merely behind main is not listed. A file opens read-only from
its worktree (`?env=<environmentId>` on the route) under a "Viewing branch X
— not the main space" banner. Bounded to the 20 most recently active
worktrees; a project without worktrees costs one environment listing.
Nothing is merged or copied back; that lands with the branch, or by hand.
