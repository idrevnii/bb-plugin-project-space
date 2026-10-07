# Annotations go back to threads

The space is a full screen, not a panel of a thread. Thus a comment that the
user writes on a page needs a clear path back to an agent. This decision
sets that path.

**Decision.** Users attach comments to places in space files, collect them
in a *Review* tab and send them to a thread. ==The agent resolves each
comment after it acts on it.==

> [!NOTE] Status
> Accepted and built for Markdown pages, HTML pages and canvases: the data
> layer, the Review tab, *Send to…* and the agent CLI
> ([architecture](../architecture/annotations.md)).

## Why

A comment helps only if it stays in place after edits and gets to the agent
with enough context. Thus the design has four steps:

1. **Anchor.** A comment on a Markdown or HTML page stores a text-quote
   selector (`exact` + `prefix` + `suffix`), so it stays in place after
   edits. A comment on a canvas stores shape ids. The plugin saves comments
   in `.bb-space/.space/annotations/`.
2. **Collect.** Comments go into a *Review* tab in the right panel.
3. **Send.** *Send to…* sends them to a thread of this project or starts a
   new thread.
4. **Resolve.** With `bb space annotations list | resolve <id>`, the agent
   marks what it did. The tab shows which comments are open and which are
   resolved.

*Send to…* has three destinations: a new thread, a composer on the screen,
or a thread of this project. The first two put the review into a composer,
and the user sends it. The third sends directly with
`bb.sdk.threads.send`. Details are in
[Architecture → Review and Send to](../architecture/annotations.md#review-and-send-to).

## Consequences

- Comments stay in the repository with the space. The tree does not show
  them.
- When you move or remove a file in the app, its comments move or go with
  it. A move outside the app (`mv`, `git mv`) leaves its comments orphaned.
