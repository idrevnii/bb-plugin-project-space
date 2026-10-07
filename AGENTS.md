# AGENTS.md

**Project Space** is a bb plugin. It gives every project a full-screen documentation
*space*: Markdown pages, sandboxed HTML and tldraw canvases that agents and people
edit together, stored in the project's `.bb-space/` folder.

This repository uses the plugin to document itself. The full documentation is in
[`.bb-space/`](.bb-space/index.md). This file covers what an agent needs before it
changes code and links to the space for the details.

## Read first

| Before you… | Read |
| --- | --- |
| touch anything | [`.bb-space/index.md`](.bb-space/index.md), [roadmap](.bb-space/roadmap.md) |
| change the page, server or file handling | [Architecture](.bb-space/architecture/index.md) and its [diagram](.bb-space/architecture/diagram.tldr) (`bb space canvas architecture/diagram.tldr` prints it as text) |
| add a file type or Markdown syntax | [File formats](.bb-space/architecture/file-formats.md) |
| work on annotations | [Annotations architecture](.bb-space/architecture/annotations.md), [decision](.bb-space/decisions/annotations.md) |
| run checks or e2e, or work in parallel | [Developing](.bb-space/guides/developing.md) |
| take a task (T32, T33, …) | [Tasks](.bb-space/tasks/index.md) and the task's brief in `.bb-space/tasks/` |
| question why something works the way it does | [Decisions](.bb-space/decisions/index.md) |
| write or edit a space page | [`skills/project-space/SKILL.md`](skills/project-space/SKILL.md), especially *Write for a reader* |

## Commands

```sh
npm install
npm run check        # typecheck + vitest + bb plugin build — must pass for every change
npm test             # unit tests only
npm run coverage     # lib/ line coverage (keep it above 80 %; it is ~98 %)
npm run e2e          # Playwright against the INSTALLED plugin in a running bb
bb plugin build && bb plugin reload project-space   # main checkout only, see below
```

You can run a single e2e script with `node scripts/e2e/<name>.mjs`. The scripts read
`BB_URL`, `PROJECT_ID` (defaults to `$BB_PROJECT_ID`) and `CHROME_PATH`. See
[Developing → End-to-end checks](.bb-space/guides/developing.md#end-to-end-checks).

## Hard rules

- **Never `bb plugin install` or `reload` from a worktree.** The installed plugin points
  at the main checkout, so reloading from a worktree swaps it out for every other agent.
  In a worktree, verify with `npm run check` only. Live checks happen at integration.
- **Only the integrator edits** [`roadmap.md`](.bb-space/roadmap.md) and the status list
  in [`tasks/index.md`](.bb-space/tasks/index.md). A task branch updates only the docs
  its brief names.
- **`lib/` is pure.** No `@get-bb/plugin-sdk` or `node:` imports, because both the server
  and the app bundle import it. Put logic that can be tested without a host here.
- **All space I/O goes through `bb.sdk.files`**, because projects on enrolled remote
  machines must work the same as local ones. `node:fs` may be used only as a fast path
  behind a check that the project's host is this machine, with `bb.sdk.files` as the
  fallback. The watcher in `server/watch-tree.ts` and the reads in `server/search.ts`
  follow this pattern.
- **Saves are compare-and-swap on the file's sha256.** Never write a file blind from
  the UI. A conflict shows the banner (*Discard mine* / *Overwrite*) and nothing is
  merged.
- **Never save over what you can't read.** Non-UTF-8 files and canvases tldraw cannot
  load stay read-only.
- **Keep `allow-same-origin` out of the HTML iframe sandbox.** HTML pages must not
  reach bb. Use `postMessage` to cross that boundary (T34).
- **Draw canvases with `space_draw` / `bb space draw`.** Never hand-write `.tldr`
  JSON. Check the result with `space_canvas_read` or `bb space canvas --png`.
- `.bb-space/.space/` is plugin bookkeeping (annotations). Don't edit it by hand.
- Don't edit `test/fixtures/diagram.tldr` to match the live diagram. It is a deliberate
  snapshot.
- `tree-left.mjs` and an off-screen `bb space draw` change state that every bb window
  shares. Run them when nobody else is using the space.

## Code map

```
server/index.ts     settings + module list → one rpcContract
server/context.ts   defineModule: contract + handlers + optional `bb space` subcommands
server/*.ts         one module per feature (files, draw, canvas-image, annotations, send, search, worktrees)
app.tsx             registers the Space page, Files/Outline/Review tabs, header button, ::space directive
ui/page/            routing, documents (text, HTML, binary, worktree), toolbar, project picker
ui/annotate/        annotations in the Markdown reader
ui/data.ts          RPC hooks that refetch on `space-changed`
lib/                pure shared code: path rules, callouts, search, annotations, canvas spec/layout/lint/read
skills/             the project-space skill agents receive
test/               vitest, one file per module under test
scripts/e2e/        Playwright scripts against a running bb
```

The [architecture page](.bb-space/architecture/index.md) explains each file and how the
parts connect.

### Adding a feature

1. Write a server module with `defineModule` (see `server/context.ts`) that holds its
   contract, handlers and any `bb space` subcommands.
2. Add it to `modules` in `server/index.ts`. Its contract joins `rpcContract`
   automatically, and the app types its client from that contract.
3. Put pure logic in `lib/` and unit-test it in `test/<module>.test.ts`. Test server
   handlers on `createFakePluginHost` and stub only the `bb.sdk` calls they make.
4. UI changes add or extend a script in `scripts/e2e/` and list it in the `e2e` script
   in `package.json`.

## Code style

- Every file opens with a short comment that says what the file is for and why it is
  shaped that way. Inside a file, comment only the non-obvious parts and keep each
  comment brief.
- TypeScript strict, ESM. UI code imports through the `@/` alias. Validate RPC input
  with zod schemas. Shared path schemas live in `server/space.ts`.
- Components and styles follow the host bb UI (`components/ui/`, Tailwind classes).
  Don't add a UI library.
- New dependencies go in `package.json`. Name each new dependency and the reason for it
  in the report or commit message.

## Docs live in the space

When a change alters behavior, update the space page that describes it in the same
change. Don't add Markdown files at the repo root.

| You changed | Update |
| --- | --- |
| what a user sees or does | [Using the space](.bb-space/guides/using-the-space.md) |
| a `bb space` command or agent tool | [For agents](.bb-space/guides/for-agents.md) **and** `skills/project-space/SKILL.md` |
| a module, data flow or storage | [Architecture](.bb-space/architecture/index.md) (and the diagram, via `space_draw`) |
| a file type or Markdown syntax | [File formats](.bb-space/architecture/file-formats.md) |
| a test or e2e script | the tables in [Developing](.bb-space/guides/developing.md) |
| a choice between approaches | a page in [`decisions/`](.bb-space/decisions/index.md): Decision, Why, Rejected, Consequences |

Write pages by the skill's rules. Start each page with a short lead and bold the one
thing the reader should remember. Use relative links, including links to code such as
`[entry](../../server/index.ts#L10)`. Give every callout and highlight a single job.
Link each new page from `index.md` or from its section's index.

## Commits

The subject line is a plain sentence in the imperative mood or describing the result,
followed by the task id when there is one, e.g. `Review tab and sending annotations to a
thread (T31)`. The body explains what changed for the user and how it was verified.
Commit only when asked. Work on a task happens on the branch `task/<id>`.
