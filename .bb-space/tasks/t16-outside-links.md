# T16 · Links to project files outside the space

A link in a space page to code in the repository (`../../server.ts`,
`/src/app.ts#L40`) opens that file in bb instead of going nowhere. Docs that
point at code are the whole point of a project space.

> [!success] Merged 2026-10-07
> Wave 1 · depends on: T01. Documented now in [Using the space → Links to code](../guides/using-the-space.md#links-to-code).

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

- [x] On a test page, `[server](../../server/index.ts#L10)` opens the file at
      line 10 in bb's preview (e2e screenshot).
- [x] Space-internal links behave exactly as before (unit tests for the
      resolver).
- [x] `npm run check` passes.

## Result (2026-10-07)

- `resolveDocumentLink` in `lib/space.ts` wraps `resolveSpaceLink`: space
  links come back unchanged; relative links that climb out of `.bb-space/`
  resolve against the checkout; `../.bb-space/x.md` comes back into the
  space; a climb above the checkout is `outside`. `#L40`, `#L40-L52` and
  `#L40-52` become a line or range (`parseLineHash`).
- Root-absolute links (`/src/app.ts`) stay in the space when the space tree
  has that path (or the tree has not loaded), otherwise go to the checkout,
  so existing `/arch/index.md` links keep working.
- `MarkdownView` renders checkout links with `experimental_FileLink`
  (`kind: "host"`); bb opens them in the right-hand preview with the lines
  highlighted. Links in the WYSIWYG editor are not clickable, as before.
- Unit tests: `test/links.test.ts`. E2E: `scripts/e2e/outside-links.mjs`,
  screenshots `outside-links-line.png` and `outside-links-range.png`.

## Out of scope

Links to other projects.

## Docs

[For agents](../guides/for-agents.md): "link to code with relative paths".
