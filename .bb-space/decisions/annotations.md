# Annotations go back to threads

**Status:** accepted — the data layer (model, anchoring, storage, RPC) is
built; see [architecture/annotations.md](../architecture/annotations.md).
The Review tab, *Send to…* and the agent CLI follow.

The space is a full screen, not a thread panel, so annotations need an
explicit route back to an agent.

1. **Anchor.** Markdown/HTML annotations store a text-quote selector
   (`exact` + `prefix` + `suffix`) so they survive edits; tldraw annotations
   store shape ids. Saved under `.bb-space/.space/annotations/`.
2. **Collect.** Comments gather in a *Review* tab in the right panel.
3. **Send.** *Send to…* picks a thread of this project or starts a new one.
   Two transports:
   - `useComposers()` — insert into a composer that is on screen (the space
     opened in a split next to a thread);
   - server `bb.sdk.threads.send` / `spawn` — when no composer is visible.
4. **Close the loop.** `bb space annotations list | resolve <id>` lets the
   agent mark what it fixed; the tray shows open vs. resolved.
