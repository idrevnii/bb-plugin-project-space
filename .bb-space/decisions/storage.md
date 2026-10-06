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
