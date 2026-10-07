# T21 · UI QA sweep

Exercise the flows nobody has checked live yet and fix what breaks.

> [!success] Done 2026-10-07
> Wave 1 · depends on: T00, T01. Every flow below has an e2e script in
> `npm run e2e`; ==seven bugs fixed==, three minor ones left open (see
> [Result](#result-2026-10-07)).

## Unverified so far

- [x] Rename and delete in the tree (files and folders, including the open one).
- [x] *File tree position* = `left`.
- [x] The **Space** button in a thread header; the `::space` card in chat
      (`bb space link`) and its *Open in space*.
- [x] The edit conflict banner: edit a page, change it on disk, save →
      *Discard mine* / *Overwrite*.
- [x] Canvas conflict: draw while an agent rewrites the file.
- [x] Non-UTF-8 and binary files, a 5 MB Markdown file, an empty space folder.
- [x] A console warning on every page: *plugin "project-space" tried to move
      `<div>` out of React's tree* (likely the off-screen renderer in
      `ui/headless.tsx`); find the cause and remove it if it is ours.
- [x] A `|` inside inline code in a table cell (written `\|` in the source)
      is saved unescaped by the WYSIWYG editor, which splits the cell. Found
      by `test/markdown-roundtrip.test.ts` while rewriting the docs; the
      space avoids the pattern for now.

## Do

One e2e script per flow under `scripts/e2e/`, then fix the bugs they expose
(smallest fix, in the file that owns the behavior).

## Acceptance

- [x] Each flow has a script that passes; `npm run e2e` runs them.
- [x] Report lists every bug found, fixed or not.
- [x] `npm run check` passes.

## Result (2026-10-07)

All 22 e2e scripts pass against the installed plugin (`npm run e2e`, 107
checks); `npm run check` is green with 233 unit tests.

### Scripts

| Script | Flow |
| --- | --- |
| `tree-rename-delete.mjs` | rename the open page and the folder holding it (the document follows), rename onto an existing name (refused), <kbd>Esc</kbd> cancels, cancelled delete, delete a page, the open page, and the open page's folder |
| `tree-left.mjs` | *File tree position* = `left`: tree beside the document, the Files tab points at it, open / create / highlight, a canvas fills the column, switching back is live |
| `space-links.mjs` | the header **Space** button (labelled, and icon-only on a narrow window); the last `::space` card in a thread shows title and path, *Open in space* opens it |
| `edit-conflict.mjs` | the banner in WYSIWYG and in *Source*: Save refused, *Discard mine*, *Overwrite*, saving normally afterwards |
| `canvas-conflict.mjs` | *Load theirs*, *Keep mine*, a rewrite while the board's save is in flight, the board's own save echoing back mid-drawing |
| `odd-files.mjs` | Latin-1 page, random bytes, NUL in a `.txt`, a PNG, a 5 MB page (reader and editor), an empty folder and a folder of only images |
| `console-warnings.mjs` | no DOM-guard warning blaming the plugin on bb home and space pages |

### Bugs

| Bug | Severity | Fix |
| --- | --- | --- |
| The DOM-guard warning was ours, and real: bb counts every DOM insert as the plugin's while a content script's `mount` promise is pending. The off-screen renderer awaited an RPC in `mount`, so bb blocked **its own** shell inserting `data-bb-plugin-app-overlays` into `#root` (the push-notifications overlay root went missing). Showed on a warm load of any page. | high | `ui/headless.tsx`: `mount` returns at once; the license fetch and the render run detached |
| A canvas lost the user's last strokes: an agent's rewrite that landed while the board's save was on its way loaded over the board, and *Keep mine* then wrote the agent's version back. | high (data loss) | `ui/TldrawView.tsx`: outside changes wait for an in-flight save to answer, then reconcile |
| A canvas's own save, echoing back before its answer while the user kept drawing, showed the conflict card and stopped autosave. Two saves in flight at once could also conflict with each other. | medium | same: one save at a time, each against the sha the previous one wrote |
| A non-UTF-8 text file (Latin-1 `.md`, any binary with a text extension) showed its **base64** as the page, and *Edit → Save* wrote that base64 over the file. | high (data loss) | `ui/page/ProjectSpace.tsx` routes base64 non-image files to `BinaryDocument.tsx`, which shows a "not UTF-8 text" notice and no Edit |
| Deleting the open page, or the folder holding it, left "does not exist (any more)" on screen. | low | `ui/FileTree.tsx`: the start page opens |
| `\|` in inline code inside a table cell was saved unescaped and split the cell. prosemirror-markdown writes code text raw. | medium | `ui/page/markdown-extensions.ts`: the code mark goes through `SpaceText`, which writes it raw except `\|` in tables; round-trip samples added |
| A quote or callout line that starts with bold, italic or a highlight (`> **Open** now`) was saved as `****Open** now`, losing its quote marker. Found when this sweep's own edit to `roadmap.md` failed the round-trip test. tiptap-markdown notes where a mark opens before the line's `>` prefix is written, then moves the delimiter at the wrong offset. | high (corrupts pages on save) | `ui/page/markdown-extensions.ts`: paragraphs write the line prefix before their text; `@tiptap/extension-paragraph` is now a direct dependency |
| `outline.mjs` failed after the docs rewrite: `roadmap.md`'s last section is too short to scroll to the top. | test only | accepts a page scrolled to its end |
| The e2e harness skipped cleanup on `fail()` (it called `process.exit`), so a failing `tree-left.mjs` left the setting on `left`. `bb()` overflowed on long thread logs. | test only | `scripts/e2e/lib.mjs`: `fail` throws inside `run`; larger `maxBuffer`; `showFiles()` reopens the Files tab bb restores to Outline |

> [!WARNING] Left open
> - **Tree on the left leaves bb's right panel open** with a Files tab that
>   only says the tree moved. Fixed tabs are registered statically, so the
>   plugin cannot hide it; close the panel by hand.
> - **Inline code ending in a space loses the space after it** on save:
>   `` `a ` b `` comes back as `` `a `b ``. ProseMirror's HTML parser folds
>   the two spaces into one across the mark boundary. Rare; the space avoids
>   it.
> - **A 5 MB page takes about 6 s** to render in the reader (2 s more for the
>   editor). It works; nothing virtualizes long pages.

Not covered: a project whose whole `.bb-space/` is empty (it takes the same
"This folder has no pages yet" branch as the empty folder that is tested),
and the `::space` card's "without a project or path" fallback, which needs a
malformed directive in a real reply.
