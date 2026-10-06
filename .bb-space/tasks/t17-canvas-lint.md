# T17 · Overlap lint for canvases

**Wave 1 · depends on: T01**

## Goal

After an agent draws, tell it which shapes overlap so it can fix its own
diagram. Server-side and tldraw-free.

## Read first

- `lib/canvas/read.ts`, `server/draw.ts`
- Original: [bb-plugin-canvas `canvas-lint.ts`](https://github.com/Borjampm/bb-plugin-canvas)
  (MIT; keep the attribution header if you port it)

## Do

1. `lib/canvas/lint.ts`: from `.tldr` records, compute page bounds for geo,
   note and text shapes (x, y, w, h; notes 200×200 unless grown; text from
   its props), and report pairs that overlap by more than a few pixels, plus
   text overflowing its box when `growY > 0` makes it obvious. Ignore arrows.
2. `describeTldr` gains an *Overlaps* section; the `space_draw` result ends
   with it and a one-line hint on how to fix (explicit x/y or `clear`).

## Acceptance

- [ ] Unit tests: two overlapping boxes reported; touching boxes not; the
      current `architecture/diagram.tldr` reports none.
- [ ] `bb space draw` of a deliberately overlapping spec prints the overlap.
- [ ] `npm run check` passes.

## Out of scope

Auto-fixing overlaps; arrow-crossing detection.

## Docs

Skill: one bullet in *Draw diagrams* in `skills/project-space/SKILL.md`.
