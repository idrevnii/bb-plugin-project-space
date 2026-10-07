# Using the space

How to open a project's space, find and organize pages, and read and edit
them. Everything here happens in bb's full-screen **Space** page; the files
behind it are the project's `.bb-space/` folder.

## Open the space

- **Sidebar → Space** opens the last project you looked at.
- The **Space** button in a thread's header opens that thread's project.
- A `::space` card an agent posted in chat → **Open in space**.

Switch projects with the selector in the page's title bar.

## Create, rename and delete pages

The **Files** tab in the right panel is the tree; the folder button at the top
right of the document shows and hides the panel.

1. Click **+** for a new page, canvas, HTML file or folder.
2. Hover a row to rename or delete it. Renaming the open page, or its
   folder, keeps it open under the new name; deleting it opens the start page.
3. Pick a folder to open its `index.md`.

> [!TIP] Tree on the left
> Settings → Plugins → Project Space → *File tree position* → `left` keeps the
> tree beside the document instead of in the panel.

## Move files

Drag a file or folder onto a folder to move it there, or onto the empty area
below the tree to move it to the space root. Dropping on a file moves into
that file's folder, and a closed folder opens after you hover it for a moment.
If the open document moves, it stays open at its new path.

From the keyboard, use the row's **Move to…** action and pick a folder with
the arrow keys and <kbd>Enter</kbd>.

> [!NOTE] Refused moves
> A folder cannot move into itself, and a move onto an existing name is
> refused.

## Find a page

The **search box** above the tree finds pages as you type: first files whose
name matches (fuzzy), then lines containing the text, in any case — in
Markdown, HTML and other text files, plus the labels on canvases.

| Key | Does |
| --- | --- |
| <kbd>↑</kbd> <kbd>↓</kbd> | pick a result |
| <kbd>Enter</kbd> or a click | open it; a text hit in a Markdown page scrolls to its section |
| <kbd>Esc</kbd> or × | clear the box and bring the tree back |

Search stops after about two seconds or 50 results; a note says when there
were more, so narrow the query.

## Jump within a page

The **Outline** tab, next to *Files*, lists the open Markdown page's headings.
Click one to scroll to it; the heading you are reading is highlighted as you
scroll. HTML pages and canvases have no outline.

## Edit a Markdown page

Markdown opens as a document; **Edit** makes the page itself editable, with
the same look as reading.

1. Format with the bar above the page: bold, italic, strikethrough,
   highlight, code, lists, task lists, quotes, code blocks, links and tables
   (row and column buttons appear while the cursor is in a table). Tick tasks
   right in the page.
2. Or type Markdown shortcuts: `## `, `- `, `1. `, `[ ] `, `` ` ``, `**`.
3. **Source** switches to the raw text with a live preview, and back.
4. Save with **Save** or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd>, then
   **Done**.

> [!WARNING] An agent may have changed the file meanwhile
> If so, saving shows a banner: keep their version (*Discard mine*) or
> *Overwrite*. Nothing is merged for you.

Saving from the editor writes *normalized* Markdown: paragraphs on one line,
`-` bullets, `| --- |` table rules. The page renders the same; only the
source layout changes, and only once you edit. Frontmatter and raw HTML
(shown as grey chips) are kept as written. A callout shows its title above
its body: edit the body in place, the `> [!type] Title` line in *Source*.
Footnote references show as small chips, and their notes stay where they are
written.

### Links to code

Links to files elsewhere in the project, like `../../server/index.ts#L10`,
open the file in bb's preview panel on the right with the line or range
(`#L10-L24`) highlighted. A link that points above the project checkout is
not clickable; hover it to see why.

## Annotations

Leave a comment on a passage of a Markdown page while reading it, on a
passage of an HTML page ([below](#comments-on-an-html-page)), or on shapes in
a canvas ([below](#comments-on-a-canvas)).

1. Select the text; a **Comment** button appears under the selection.
2. Write the comment and save with **Save** or
   <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd>; <kbd>Esc</kbd> cancels.
3. The passage stays highlighted. Click it to read the comment, **Edit** it,
   **Resolve** (or **Reopen**) it, or **Delete** it. <kbd>Esc</kbd> while
   editing leaves editing and keeps the comment open.

The highlight follows the passage when the page is edited, by you or an
agent, as long as the passage is still roughly there. A resolved comment is
underlined instead of filled.

> [!NOTE] When the text is gone
> If the passage is deleted or rewritten beyond recognition, the comment is
> kept and listed under the page title as *comment whose text is gone*.
> Click it to edit or delete it.

Selecting text while editing does not offer *Comment*: press **Done** first.
Comments live in `.bb-space/.space/annotations/` and move with the page when
you rename or move it in the tree.

### Comments on an HTML page

Press **Annotate** in the toolbar first. Then comment as on a Markdown page:
select text, press **Comment**, save. Highlights and comments whose text is
gone show only while **Annotate** is on; they are listed above the page.

The page's own scripts keep running in **Annotate** mode, and it still
cannot reach bb. Opening a comment from the **Review** tab turns
**Annotate** on by itself.

### Comments on a canvas

On a canvas, a comment points at shapes instead of text.

1. Select one or more shapes; a **Comment** button appears under the
   selection. Right-clicking the selection offers **Comment** too.
2. Write the comment and save, as on a page.
3. ==A numbered badge sits on the top-right corner of the shapes== and moves
   with them and with the view. Click it to read, edit, resolve or delete
   the comment; a dashed frame shows which shapes it is on.

A comment stays on its shapes when they are moved, resized or restyled, and
when an agent redraws the same node ids. It is lost only when every shape it
points at is deleted.

> [!NOTE] When the shapes are gone
> The comment is kept and listed in the board's top-left corner as *comment
> whose shapes are gone*. Click it to edit or delete it. Undoing the delete
> brings the badge back.

Agents see canvas comments too: `bb space canvas` prints each one under the
shape it points at.

### Review and send to an agent

The **Review** tab in the right panel lists the project's comments by file:
open ones first, then sent, then resolved. Click a comment to open its page
scrolled to it, or its canvas centered on its shapes.

1. Every open comment is ticked. Untick the ones to leave out.
2. Press **Send to…** and pick where the review goes:
   - **New thread** opens the new-thread composer with the review in it.
   - **Composer on screen** adds it to a composer that is open now.
   - **Thread of this project** posts it to that thread at once.
3. The message lists each comment with its quote and id, and tells the agent
   to resolve each one with `bb space annotations resolve`.

A comment is marked *sent* when the message is sent, whichever way it went,
and the tab updates without a reload. A prefilled draft you never send marks
nothing.

> [!NOTE] New thread uses the composer's project
> **New thread** opens the composer with the project it last had selected.
> Check it before sending.

## HTML pages and canvases

HTML files render like a browser page, scripts included, in a sandbox that
cannot reach bb. Canvases are full tldraw boards and save themselves 800 ms
after the last edit. A canvas whose file tldraw cannot load opens read-only,
with the reason, until the file is fixed.

If an agent rewrites a canvas while you have strokes it has not saved yet, a
card offers **Load theirs** (your strokes go) or **Keep mine** (their version
goes). A save already on its way waits for the answer first, so nothing is
lost in between.

> [!NOTE] Files that are not UTF-8 text
> A Latin-1 page or a binary file with a text extension shows a notice instead
> of its contents and has no **Edit**, so the space never saves over it.

## Worktrees

The space you see is the one in the project's **main checkout**. A thread
that runs in a worktree and writes its own `.bb-space/` there shows up as a
badge in the bar above the page: "1 worktree changed the space".

1. Click the badge to see each worktree's branch, its threads, and the files
   it added (**A**), changed (**M**) or deleted (**D**).
2. Click a file to open it read-only from that worktree, under a "Viewing
   branch … — not the main space" banner.
3. **Open main version** goes back.

> [!IMPORTANT] Nothing is copied into the main space
> Those edits arrive when the branch is merged. Why it works this way:
> [storage decision](../decisions/storage.md).

## Settings

Settings → Plugins → Project Space:

| Setting | Values | Does |
| --- | --- | --- |
| *File tree position* | `right` (default), `left` | tree in the page's side panel, or beside the document |
| *Reading style* | `blue-topaz` (default), `things`, `plain` | how Markdown pages look — see the [decision](../decisions/reading-styles.md) |
| *tldraw license key* | a key, or empty | only needed when bb is opened over a non-local https address, such as bb connect |

The **Blue Topaz** and **Things** themes in Settings → Appearance give agent
replies and file previews the same Markdown look.
