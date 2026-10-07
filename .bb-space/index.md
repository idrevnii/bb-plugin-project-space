# Project Space

A bb plugin that gives every project a full-screen documentation **space**:
Markdown pages, browser-rendered HTML and tldraw canvases that agents and
people edit together. ***The space is the `.bb-space/` folder in the project's
checkout, so it lives in git next to the code it describes.***

> [!NOTE] This space documents the plugin itself
> It is written and read with the plugin it describes, so every page here is
> also a live test of the reader.

## Where to start

| Page | Read it when you want to |
| --- | --- |
| [Using the space](guides/using-the-space.md) | open a space, create pages, edit, search, move files |
| [For agents](guides/for-agents.md) | know which `bb space` commands and tools an agent has |
| [Architecture](architecture/index.md) | see how the page, server and files fit together |
| [File formats](architecture/file-formats.md) | look up what each extension opens as, and the Markdown syntax |
| [Annotations](architecture/annotations.md) | build on the annotation model, storage and RPC |
| [Developing](guides/developing.md) | run the checks and e2e scripts, or work in parallel |
| [Decisions](decisions/index.md) | find out why something is the way it is |
| [Roadmap](roadmap.md) | see what is done and what is next |
| [Tasks](tasks/index.md) | pick up a brief an agent can take alone |
| [Status report](reports/status.html) | glance at progress as a visual page |

## Where it stands

Version `0.1.0`, updated 2026-10-07. Everything in the MVP and wave 1 is
merged: pages and folders with drag and drop, search and an outline; WYSIWYG
Markdown with callouts, Mermaid and links into the code; sandboxed HTML;
tldraw canvases that agents draw on, lint and see as PNGs; live refresh;
worktree awareness; unit and e2e tests; a UI QA sweep. Annotations work on
Markdown pages and canvases: comments gather in the Review tab, go to a
thread, and agents resolve them with `bb space annotations`.

> [!IMPORTANT] Next up
> Annotating HTML pages (T34), the last task of the annotations UI. See the
> [roadmap](roadmap.md).
