// Annotating a Markdown page in the reader: select a phrase, *Comment*, save
// with Ctrl/⌘+Enter; the phrase is highlighted, and still is after a reload
// and after the page is edited so the phrase moves. Clicking the highlight
// opens the comment: edit, resolve. Deleting the phrase lists the comment as
// orphaned under the title, where it can be deleted. Selecting text in edit
// mode offers no *Comment*. Cleans up its scratch page and annotations.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, PROJECT_ID, SPACE, autoDeleteResolved, bb, fail, ok, panel, run, spaceUrl, waitFor } from "./lib.mjs";

const PATH = "scratch-e2e-annotate.md";
const file = join(SPACE, PATH);
const annotationFile = join(SPACE, ".space", "annotations", `${PATH}.json`);
const PHRASE = "brown fox jumps";
const inputFile = join(OUT, "annotations-markdown-input.json");

function list() {
  writeFileSync(inputFile, JSON.stringify({ projectId: PROJECT_ID, path: PATH }));
  return JSON.parse(bb("plugin", "rpc", "call", "project-space", "annotations_list", "--input-file", inputFile, "--json"))
    .annotations;
}

/** Selects the first occurrence of `text` inside the reader's article. */
async function select(page, text) {
  await page.evaluate((phrase) => {
    const article = document.querySelector('[data-testid="plugin-panel-body"] article');
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(phrase);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + phrase.length);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`no ${phrase} in the article`);
  }, text);
}

/** The text of every range in a named CSS highlight. */
const highlighted = (page, name = "space-annotation") =>
  page.evaluate((highlight) => [...(CSS.highlights.get(highlight) ?? [])].map((range) => range.toString()), name);

writeFileSync(file, "# Annotate e2e\n\nThe quick brown fox jumps over the lazy dog.\n");

await run(
  async ({ page }) => {
    const body = panel(page);
    await page.goto(spaceUrl(PATH));
    await body.getByText("The quick brown fox").waitFor({ timeout: 20_000 });

    await select(page, PHRASE);
    const comment = body.getByRole("button", { name: "Comment", exact: true });
    await comment.waitFor({ timeout: 5_000 });
    await page.screenshot({ path: join(OUT, "annotations-markdown-select.png") });
    await comment.click();
    const dialog = body.getByRole("dialog", { name: "New comment" });
    await dialog.getByRole("textbox", { name: "Comment" }).fill("Name the fox");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    await dialog.waitFor({ state: "detached", timeout: 5_000 });
    await waitFor("the annotation to be stored", () => list().length === 1);
    const [stored] = list();
    if (stored.anchor.exact !== PHRASE || !stored.anchor.prefix.endsWith("The quick ") || stored.anchor.prefix.includes("#")) {
      fail(`anchor is not against the rendered text: ${JSON.stringify(stored.anchor)}`);
    }
    await waitFor("the phrase to be highlighted", async () => (await highlighted(page)).join() === PHRASE);
    ok("a selected phrase gets a comment and a highlight");

    await page.reload();
    await body.getByText("The quick brown fox").waitFor({ timeout: 20_000 });
    await waitFor("the highlight after a reload", async () => (await highlighted(page)).join() === PHRASE);
    ok("the highlight is there after a reload");

    writeFileSync(file, "# Annotate e2e\n\nA new first paragraph.\n\nToday the quick brown fox jumps over a lazy cat.\n");
    await body.getByText("A new first paragraph.").waitFor({ timeout: 10_000 });
    await waitFor("the highlight to follow the edit", async () => (await highlighted(page)).join() === PHRASE);
    await page.screenshot({ path: join(OUT, "annotations-markdown-moved.png") });
    ok("the highlight follows the phrase when the page changes");

    const box = await page.evaluate(() => {
      const [range] = [...CSS.highlights.get("space-annotation")];
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    const card = body.getByRole("dialog", { name: "Comment" });
    await card.getByText("Name the fox").waitFor({ timeout: 5_000 });
    if ((await highlighted(page, "space-annotation-active")).join() !== PHRASE) fail("open comment is not marked active");
    // Esc while editing leaves editing, not the card.
    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByRole("textbox", { name: "Comment" }).press("Escape");
    await card.getByRole("button", { name: "Edit" }).waitFor({ timeout: 5_000 });
    ok("Esc while editing a comment keeps the card open");
    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByRole("textbox", { name: "Comment" }).fill("Name the fox, please");
    await card.getByRole("button", { name: "Save" }).click();
    await card.getByText("Name the fox, please").waitFor({ timeout: 5_000 });
    await waitFor("the edit to be stored", () => list()[0]?.comment === "Name the fox, please");
    const before = list()[0];
    await card.getByRole("button", { name: "Resolve" }).click();
    if (autoDeleteResolved()) {
      await card.waitFor({ state: "detached", timeout: 5_000 });
      await waitFor("the resolve to delete it", () => list().length === 0);
      await waitFor("no highlight", async () => (await highlighted(page)).length === 0);
      ok("clicking the highlight opens the comment; edit is stored, Resolve deletes it");
      // The steps below need the comment again.
      writeFileSync(inputFile, JSON.stringify({ projectId: PROJECT_ID, path: PATH, anchor: before.anchor, comment: before.comment }));
      bb("plugin", "rpc", "call", "project-space", "annotations_create", "--input-file", inputFile, "--json");
      await waitFor("the comment again", async () => (await highlighted(page)).join() === PHRASE);
    } else {
      await waitFor("the resolve to be stored", () => list()[0]?.status === "resolved");
      await card.getByRole("button", { name: "Reopen" }).waitFor({ timeout: 5_000 });
      await page.screenshot({ path: join(OUT, "annotations-markdown-card.png") });
      await page.keyboard.press("Escape");
      await card.waitFor({ state: "detached", timeout: 5_000 });
      await waitFor("the resolved highlight", async () => (await highlighted(page, "space-annotation-resolved")).join() === PHRASE);
      ok("clicking the highlight opens the comment; edit and resolve are stored");
    }

    writeFileSync(file, "# Annotate e2e\n\nA new first paragraph.\n\nNothing about animals any more.\n");
    await body.getByText("Nothing about animals").waitFor({ timeout: 10_000 });
    const orphaned = body.getByTestId("orphaned-annotations");
    await orphaned.getByText("Name the fox, please").waitFor({ timeout: 10_000 });
    const underTitle = await page.evaluate(() => {
      const title = document.querySelector('[data-testid="plugin-panel-body"] article h1');
      return title?.nextElementSibling?.querySelector('[data-testid="orphaned-annotations"]') != null;
    });
    if (!underTitle) fail("orphaned list is not right under the title");
    if ((await highlighted(page, "space-annotation-resolved")).length !== 0) fail("an orphan is still highlighted");
    await page.screenshot({ path: join(OUT, "annotations-markdown-orphaned.png") });
    ok("a deleted phrase leaves its comment listed as orphaned under the title");

    await orphaned.getByRole("button").first().click();
    await card.getByRole("button", { name: "Delete" }).click();
    await waitFor("the delete to be stored", () => list().length === 0);
    await orphaned.waitFor({ state: "detached", timeout: 5_000 });
    ok("an orphaned comment can be deleted from the list");

    await body.getByRole("button", { name: "Edit" }).click();
    const editor = body.locator(".ProseMirror");
    await editor.waitFor({ timeout: 10_000 });
    await editor.getByText("Nothing about animals").dblclick();
    await page.waitForTimeout(500);
    if (await comment.isVisible()) fail("Comment offered in the WYSIWYG editor");
    await body.getByRole("button", { name: "Source" }).click();
    await body.locator("article").waitFor({ timeout: 5_000 });
    await select(page, "Nothing about");
    await page.waitForTimeout(500);
    if (await comment.isVisible()) fail("Comment offered in the Source preview");
    await body.getByRole("button", { name: "Done" }).click();
    ok("edit mode offers no Comment");
  },
  () => {
    rmSync(file, { force: true });
    rmSync(annotationFile, { force: true });
    rmSync(inputFile, { force: true });
  },
);
