# T16 · Links to project files outside the space

**Wave 1 · depends on: T01**

## Goal

A link in a space page to code in the repository (`../../server.ts`,
`/src/app.ts#L40`) opens that file in bb instead of going nowhere. Docs that
point at code are the whole point of a project space.

## Read first

- `ui/MarkdownView.tsx` (link component), `lib/space.ts → resolveSpaceLink`
- SDK: `useBbNavigate().experimental_openFilePreview(...)` and
  `experimental_FileLink` (see `bb-plugin-sdk-app.d.ts`, *ExperimentalLiveFileTarget*
  with `kind: "host"`)

## Do

1. Extend link resolution: relative links that climb out of `.bb-space/`
   resolve against the project checkout (needs the checkout path and host id
   from `space_info`; add `checkoutPath` and `hostId` to its output).
   `#L40` / `#L40-L52` become a line range.
2. Render those links with bb's host file link / preview so they open in the
   right panel with the line highlighted.
3. Links that escape the checkout stay plain text with a title explaining why.

## Acceptance

- [ ] On a test page, `[server](../../server/index.ts#L10)` opens the file at
      line 10 in bb's preview (e2e screenshot).
- [ ] Space-internal links behave exactly as before (unit tests for the
      resolver).
- [ ] `npm run check` passes.

## Out of scope

Links to other projects.

## Docs

[For agents](../guides/for-agents.md): "link to code with relative paths".
