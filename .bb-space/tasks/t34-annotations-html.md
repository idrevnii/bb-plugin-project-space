# T34 · Annotate HTML pages

Select text in a rendered HTML page and comment on it, without giving the
page access to bb.

> [!todo] Ready to start
> Wave 2 · depends on: T10. T10 is merged.

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

- [ ] e2e on `reports/status.html`: annotate a heading, reload, highlight is
      there; the page's own scripts still run in annotate mode.
- [ ] A hostile page posting fake messages cannot create annotations without
      a real selection by the user (explain the check in the report).
- [ ] `npm run check` passes.

## Docs

[Architecture](../architecture/index.md) → HTML section: the bridge and its
security rules.
