# Using the space

## Open it

- **Sidebar → Space.** Opens the last project you looked at.
- **Space** button in a thread's header — opens that thread's project.
- A `::space` card an agent posted in chat → **Open in space**.

Switch projects with the selector in the page's title bar.

## Files

The **Files** tab in the right panel is the tree (toggle the panel with the
folder button at the top right of the document). Use **+** for a new page,
canvas, HTML file, or folder; hover a row to rename or delete it. A folder's
`index.md` opens when you pick the folder.

Drag a file or folder onto a folder to move it there, or onto the empty area
below the tree to move it to the space root. Dropping on a file moves into
that file's folder, and a closed folder opens after you hover it for a moment.
From the keyboard, use the row's **Move to…** action and pick a folder (arrow
keys, Enter). A folder can't move into itself, and a move onto an existing
name is refused. If the open document moves, it stays open at its new path.

The **search box** above the tree finds pages as you type: first files
whose name matches (fuzzy), then lines that contain the text, in any case,
in Markdown, HTML and other text files, plus the labels on canvases. The
results replace the tree until you clear the box (**Esc** or ×). Arrow keys
pick a result and **Enter** (or a click) opens it; a text hit in a Markdown
page scrolls to the section it is in. Search reads files as you type and
stops after about two seconds or 50 results; a note says when there were
more, so narrow the query.

Prefer the tree beside the document? Settings → Plugins → Project Space →
*File tree position* → `left`.

## Outline

The **Outline** tab, next to *Files* in the right panel, lists the open
Markdown page's headings. Click one to scroll the page to it; the heading
you are reading is highlighted as you scroll. Other files (HTML, canvases)
have no outline.

## Reading and editing

Markdown opens as a document. **Edit** makes the page itself editable, with
the same typography as reading. The bar above it formats text, makes lists,
task lists, quotes, code blocks, links and tables (row and column buttons
appear while the cursor is in a table); tick tasks right in the page. Markdown
shortcuts work as you type (`## `, `- `, `1. `, `[ ] `, `` ` ``, `**`).
**Source** switches to the raw text with a live preview, and back.

Save with **Save** or `Ctrl/⌘+S`, then **Done**. If an agent changed the file
while you were editing, a banner lets you keep theirs or overwrite.

Saving from the editor writes normalized Markdown: paragraphs on one line,
`-` bullets, `| --- |` table rules. The page renders the same; only the
source layout changes, and only once you edit. Frontmatter and raw HTML
(shown as grey chips) are kept as written.

Links to code elsewhere in the project (`../../server/index.ts#L10`) open
the file in bb's preview panel on the right, with the line or range
(`#L10-L24`) highlighted. A link that points above the project checkout is
not clickable; hover it to see why.

HTML files render like a browser page. Canvases are full tldraw boards and
save themselves.
