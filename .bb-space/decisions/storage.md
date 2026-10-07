# Storage in `.bb-space/`

The place of the space decides if the docs stay next to the code or move
away from it. This is the first decision of the plugin.

**Decision.** ***The space of a project is the `.bb-space/` folder in its
default checkout.*** The plugin reads and writes it through `bb.sdk.files`.

## Why

The problem: you come back to a project after months and find many Markdown
files that nobody can read. Docs in the repository have the same versions
as the code. They stay when you install bb again. Agents write them with the
file tools that they already use, so there is no special API to learn or to
break. `bb.sdk.files` uses the project's host. Thus a project on an enrolled
machine works the same as a local project.

## Rejected

- **Plugin SQLite, or a bb Docs vault outside the repository** — these have
  no history, and the docs move away from the code.
- **A `docs/` folder at the root** — many repositories already have one, with
  other rules. A special dot-folder makes the rules of the space clear.

## Consequences

A thread in a worktree has its own checkout, so it can write a separate
copy of the space. Two features handle this:

- **`bb space root` points at the main checkout.** An agent in a worktree
  writes where the user looks, and the user sees the edit immediately.
- **The Space screen shows the copies in worktrees**, if an agent wrote
  there anyway. A badge in the toolbar, for example "2 worktrees changed the
  space", lists each live worktree. For each worktree, it shows the branch,
  the threads and the space files that the branch changed since the merge
  base. It lists a file only if its sha256 is different from the file in the
  main space. Committed and uncommitted changes both count.

| Rule | Value |
| --- | --- |
| changes in the list | added, changed, deleted |
| a branch that is only behind main | not in the list |
| worktrees that the badge checks | the 20 with the most recent activity |
| cost without worktrees | one list of environments |
| a file that you open | read-only, with `?env=<environmentId>` on the route, under the banner "Viewing branch X — not the main space" |

> [!IMPORTANT] The badge copies nothing back
> Edits in a worktree go into the main space only when someone merges the
> branch, or copies them by hand. A copy action in the badge is a possible
> next step. It is not built.

What the user sees: [Use the space → Worktrees](../guides/using-the-space.md#worktrees).
