Give every project a place for documentation people actually read.

## What you get

- A full-screen **Space** page per project, opened from the sidebar or the
  **Space** button in any thread's header.
- A file tree of pages and folders in the right panel (or beside the
  document — your choice in settings).
- Markdown that reads like a document, HTML that renders like a web page,
  and tldraw canvases you can draw on.
- Reading styles after the Obsidian themes **Blue Topaz** and **Things**:
  headings colored by level, styled bold, italic, code and quotes. Matching
  palettes in Settings → Appearance bring the same look to agent replies.
- Live updates: when an agent writes a page, it appears while you look.

## How it works

The space is the `.bb-space/` folder inside the project, so it is versioned
with your code. Nothing leaves your machine except tldraw's editor assets,
which load from tldraw's CDN.

## For agents

The bundled skill tells agents to find the space with `bb space root`, keep
`index.md` as the front page, organize pages by topic, and post a `::space`
card linking to what they wrote.
