# T32 · Annotations for agents

Agents can list, answer and resolve annotations, closing the loop T31 opens.

> [!success] Done 2026-10-07
> Wave 2 · depends on: T10. Documented in [For agents → When the user sends annotations](../guides/for-agents.md#comments-from-the-user)
> and [Annotations → For agents](../architecture/annotations.md#for-agents).

## Read first

- `lib/annotations.ts`, `server/annotations.ts` (T10), `server/cli.ts`

## Do

1. CLI: `bb space annotations list [--path p] [--status open|sent|resolved] [--json]`,
   `bb space annotations show <id>` (comment, anchor, and the quoted text
   with ±3 lines of current context, located with `locateQuote`),
   `bb space annotations resolve <id> [--note "…"]`,
   `bb space annotations reply <id> "…"` (author `agent`, kept on the
   annotation as `resolution` until resolved).
2. Agent tool `space_annotations` with actions `list | show | resolve`.
3. Skill: a section *When the user sends annotations* — read each with
   `show`, change the file, then `resolve` with a one-line note.

## Acceptance

- [x] Round trip: create with RPC, `list` shows it, `show` prints context,
      `resolve` flips it and the Review tab (if merged) reflects it live.
- [x] Bounded output (< 64 KB) for spaces with many annotations.
- [x] `npm run check` passes.

## Notes

- Code: [`server/annotations-agent.ts`](../../server/annotations-agent.ts)
  (commands and tool), [`lib/annotation-text.ts`](../../lib/annotation-text.ts)
  (what they print). Checked by `test/annotations-agent.test.ts` and
  `scripts/e2e/annotations-agent.mjs`.
- The Review tab now shows a reply under an open comment too, not only the
  note of a resolved one.
- Output is held under 60 KB, below the 64 KB the brief asks for, to leave
  room for the CLI's own framing.

## Docs

[For agents](../guides/for-agents.md) and `skills/project-space/SKILL.md`.
