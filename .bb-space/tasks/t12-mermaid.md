# T12 · Mermaid diagrams in Markdown

**Wave 1 · depends on: T01**

## Goal

Fenced ` ```mermaid ` blocks render as diagrams in the reader, because agents
write them constantly.

## Read first

- `ui/MarkdownView.tsx` (`CodeBlock`)

## Do

1. `ui/MermaidBlock.tsx`: render with `mermaid` (`securityLevel: "strict"`),
   theme following bb's `dark` class on `<html>` (see `useHostColorScheme`
   in `ui/TldrawView.tsx`), re-render on theme change.
2. In `CodeBlock`, language `mermaid` → `MermaidBlock`; on a parse error show
   the error line plus the source with bb's source viewer.
3. Load mermaid lazily if `bb plugin build` supports dynamic import; if it
   does not, say so and measure the bundle cost.

## Acceptance

- [ ] A flowchart, a sequence diagram and a broken diagram on a test page
      render (two diagrams, one error) in light and dark (e2e screenshots).
- [ ] Bundle size before/after in your report.
- [ ] `npm run check` passes.

## Out of scope

Editing diagrams visually; converting mermaid to tldraw.

## Docs

Add a mermaid example to [file formats](../architecture/file-formats.md).
