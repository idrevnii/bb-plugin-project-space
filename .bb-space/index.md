# Project Space

A bb plugin that gives every project a full-screen documentation **space**:
Markdown pages, browser-rendered HTML, and tldraw canvases that agents and
people edit together. The space is the `.bb-space/` folder in the project's
checkout, so it lives in git next to the code it describes.

> This space documents the plugin itself — it is built and read with the
> plugin it describes.

## Start here

| Page | What it covers |
|---|---|
| [Architecture](architecture/index.md) | How the page, panel, server, and files fit together |
| [Using the space](guides/using-the-space.md) | Opening a space, creating pages, editing, canvases |
| [For agents](guides/for-agents.md) | How agents find and write the space |
| [Developing](guides/developing.md) | Checks, e2e scripts, and rules for parallel work |
| [Decisions](decisions/index.md) | Why things are the way they are |
| [Roadmap](roadmap.md) | What is done, what is next |
| [Tasks](tasks/index.md) | The roadmap cut into briefs agents can take in parallel |
| [Status report](reports/status.html) | A visual HTML page, rendered like a browser |

## Status

`0.1.0`, updated 2026-10-07. Pages and folders with drag and drop, search and
an outline; WYSIWYG Markdown with mermaid diagrams and links into the code;
sandboxed HTML; tldraw canvases that agents draw on, lint, and see as PNGs;
live refresh; worktree awareness; unit and e2e tests. The annotations data
layer is built; its UI, agent CLI, and the UI QA sweep are next — see the
[roadmap](roadmap.md).
