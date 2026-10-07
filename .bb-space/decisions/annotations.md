# Annotations go back to threads

The space is a full screen, not a thread panel, so a comment the user leaves
on a page needs an explicit route back to an agent. This decision fixes that
route.

**Decision.** Users pin comments to places in space files, collect them in a
*Review* tab, and send them to a thread; ==the agent resolves each one when it
has acted on it==.

> [!NOTE] Status
> Accepted and built for Markdown pages, HTML pages and canvases: the data
> layer, the Review tab, *Send to…* and the agent CLI
> ([architecture](../architecture/annotations.md)).

## Why

Comments only help if they survive edits and reach the agent with enough
context to act. So the design has four steps:

1. **Anchor.** Markdown and HTML annotations store a text-quote selector
   (`exact` + `prefix` + `suffix`), so they survive edits; tldraw annotations
   store shape ids. They are saved under `.bb-space/.space/annotations/`.
2. **Collect.** Comments gather in a *Review* tab in the right panel.
3. **Send.** *Send to…* picks a thread of this project or starts a new one.
4. **Close the loop.** `bb space annotations list | resolve <id>` lets the
   agent mark what it fixed; the tab shows open versus resolved.

Sending has two transports, picked by what is on screen:

| Situation | Transport |
| --- | --- |
| the space is open in a split next to a thread | `useComposers()` inserts into that composer; the user sends |
| no composer visible | server `bb.sdk.threads.send` / `spawn` |

## Consequences

- Annotations live in the repo with the space, hidden from the tree.
- Moves and removes made in the app carry annotations along; moves made
  outside it (`mv`, `git mv`) leave them orphaned.
