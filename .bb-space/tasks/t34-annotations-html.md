# T34 · Annotate HTML pages

Select text in a rendered HTML page and comment on it, without giving the
page access to bb.

> [!success] Merged 2026-10-08
> Wave 2 · depends on: T10. The code came into `main` with the T33 commit
> (`3ded232`). Documented in [Annotations → HTML pages](../architecture/annotations.md#html-pages)
> and [Architecture → The annotation bridge](../architecture/index.md#the-annotation-bridge).

## Read first

- `ui/page/HtmlFrame.tsx`, `lib/annotations.ts`
- Constraint: the iframe is sandboxed **without** `allow-same-origin`, so the
  parent cannot touch its DOM. Keep it that way.

## Do

1. *Annotate* mode for HTML: render the file through `srcdoc` (as the edit
   preview already does, with `<base>` set to the preview URL) and inject a
   small bridge script (`ui/annotate/html-bridge.ts`, bundled as a string)
   that:
   - posts `{ type: "selection", exact, prefix, suffix, rect }` on mouseup
     with a non-empty selection;
   - accepts `{ type: "highlight", annotations }` and marks quotes with the
     CSS Custom Highlight API; posts `{ type: "click", id }` on a highlight.
2. The parent validates every message (`event.source === iframe.contentWindow`,
   schema-checked) and shows the same comment popover as T30.
3. Normal view mode stays the plain preview URL (no injection).

## Acceptance

- [x] e2e on `reports/status.html`: annotate a heading, reload, highlight is
      there; the page's own scripts still run in annotate mode.
- [x] A hostile page posting fake messages cannot create annotations without
      a real selection by the user (explain the check in the report).
- [x] `npm run check` passes.

## Result (2026-10-08)

- The integrator ran `scripts/e2e/annotations-html.mjs` against `main`
  after the review fixes of the T33 commit. All 7 checks passed: the page's
  script runs, forged messages and script selections get no *Comment*, a
  heading gets a comment that stays after a reload, a click and the Review
  tab open it, and *Annotate* off shows the plain preview URL.
- After a build and a reload, the full `npm run e2e` (27 scripts) passed.
  Three checks were skipped by their conditions: a send to an existing
  thread (`REVIEW_THREAD_ID` not set), the worktree badge (no live
  worktree) and the `::space` card (the thread has no card).
- The security checks are in
  [Architecture → The annotation bridge](../architecture/index.md#the-annotation-bridge)
  and in `test/html-bridge.test.ts`.

## Docs

[Architecture](../architecture/index.md) → HTML section: the bridge and its
security rules.
