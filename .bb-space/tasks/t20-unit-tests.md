# T20 · Unit tests for the pure core

**Wave 1 · depends on: T00 (harness), T01 (paths)**

## Goal

Cover the code everything else relies on, so parallel work can refactor
safely.

## Do

`test/` with vitest:
- `lib/space.ts`: `normalizeSpacePath` (escapes, `..`, backslashes, NUL,
  empty), `resolveSpaceLink` (relative, absolute-in-space, `..` out of
  space → null, URLs, anchors, encoded names), `fileKind`, `displayName`.
- `lib/canvas/layout.ts`: node sizes grow with labels; `tb` and `lr` place
  layers along the axis; cycles do not loop forever; anchored layouts stay
  anchored.
- `lib/canvas/read.ts`: describes nodes/arrows/text from a fixture `.tldr`
  (copy `architecture/diagram.tldr` into `test/fixtures/`); empty and broken
  files.
- `lib/canvas/spec.ts`: rejects bad colors, too many nodes.
- Server handlers that can run against the SDK's fake host
  (`@get-bb/plugin-sdk/testing`), if it supports `files`: `space_write`
  conflict path, path validation rejects `../`.

## Acceptance

- [ ] `npm test` passes; coverage report for `lib/` above 80% lines.
- [ ] No production code changes except to fix real bugs the tests found
      (list them).

## Docs

`guides/developing.md` (from T00): where tests live.
