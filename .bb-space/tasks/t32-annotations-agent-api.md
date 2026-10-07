# T32 · Annotations for agents

Agents can list, answer and resolve annotations, closing the loop T31 opens.

> [!todo] Ready to start
> Wave 2 · depends on: T10. T10 is merged.

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

- [ ] Round trip: create with RPC, `list` shows it, `show` prints context,
      `resolve` flips it and the Review tab (if merged) reflects it live.
- [ ] Bounded output (< 64 KB) for spaces with many annotations.
- [ ] `npm run check` passes.

## Docs

[For agents](../guides/for-agents.md) and `skills/project-space/SKILL.md`.
