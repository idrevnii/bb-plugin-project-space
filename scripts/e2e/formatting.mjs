// Writes a scratch page with callouts (GitHub and Obsidian forms, one
// foldable), ==highlights==, <kbd>/<mark>/<details>, footnotes and a script
// tag; checks the reader renders each, drops the script, and that a footnote
// link scrolls to its note. Then opens the WYSIWYG editor, checks the callout
// label and footnote chips show, saves without edits, and checks the file is
// unchanged. Deletes the page afterwards.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, SPACE, fail, ok, panel, run, spaceUrl, waitFor } from "./lib.mjs";

const PATH = "scratch-e2e-formatting.md";
const file = join(SPACE, PATH);
const CONTENT = `# Formatting e2e

> [!NOTE]
> A GitHub note.

> [!warning] Mind the **gap**
> An Obsidian warning with a title.

> [!tip]- Folded tip
> Hidden until opened.

Some ==highlighted **bold** text== here. Press <kbd>Ctrl</kbd>+<kbd>S</kbd>, see <mark>marked</mark>.

<details><summary>Raw details</summary>

Inside details.

</details>

A claim[^src].

[^src]: The footnote text.

<script>window.__e2eInjected = true</script>
`;

writeFileSync(file, CONTENT);

await run(
  async ({ page }) => {
    const body = panel(page);
    await page.goto(spaceUrl(PATH));
    await body.getByText("Formatting e2e").waitFor({ timeout: 20_000 });
    const article = body.locator("article");

    const callouts = article.locator("[data-callout]");
    await waitFor("three callouts", async () => (await callouts.count()) === 3);
    const kinds = await callouts.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-callout")));
    if (kinds.join() !== "note,warning,tip") fail(`callout kinds: ${kinds.join()}`);
    const titles = await article.locator("[data-callout-title]").allInnerTexts();
    if (titles.map((title) => title.trim()).join("|") !== "Note|Mind the gap|Folded tip") {
      fail(`callout titles: ${titles.join("|")}`);
    }
    if ((await article.locator("details[data-callout]:not([open])").count()) !== 1) fail("folded tip is not closed");
    if (await article.getByText("Hidden until opened.").isVisible()) fail("folded body is visible");
    await article.getByText("Folded tip").click();
    await article.getByText("Hidden until opened.").waitFor({ state: "visible", timeout: 5_000 });
    ok("callouts render with kinds and titles; the foldable one opens");

    const marks = await article.locator("mark").allInnerTexts();
    if (marks.join("|") !== "highlighted bold text|marked") fail(`marks: ${marks.join("|")}`);
    if ((await article.locator("kbd").count()) !== 2) fail("expected two <kbd>");
    if ((await article.locator("details:not([data-callout]) > summary", { hasText: "Raw details" }).count()) !== 1) {
      fail("raw <details> missing");
    }
    if (await page.evaluate(() => "__e2eInjected" in window)) fail("<script> ran");
    if ((await article.locator("script").count()) !== 0) fail("<script> left in the page");
    ok("highlights, <kbd>, <mark> and <details> render; <script> is dropped");

    await article.locator("[data-footnote-ref]").click();
    const note = article.locator("section.footnotes li", { hasText: "The footnote text." });
    await waitFor("the footnote to scroll into view", async () => note.isVisible() && (await note.evaluate((el) => {
      const { top, bottom } = el.getBoundingClientRect();
      return top >= 0 && bottom <= window.innerHeight;
    })));
    ok("footnote link scrolls to its note");

    for (const theme of ["dark", "light"]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
      await article.evaluate((el) => el.scrollIntoView());
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(OUT, `formatting-${theme}.png`), fullPage: true });
    }

    await body.getByRole("button", { name: "Edit" }).click();
    const editor = body.locator(".ProseMirror");
    await editor.waitFor({ timeout: 10_000 });
    const labels = await editor
      .locator("blockquote[data-callout]")
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node, "::before").content));
    if (labels.join("|") !== '"Note"|"Mind the gap"|"Folded tip"') fail(`editor callout labels: ${labels.join("|")}`);
    if ((await editor.locator(".space-footnote-ref").innerText()) !== "src") fail("editor footnote reference chip");
    if ((await editor.locator(".space-footnote-def", { hasText: "The footnote text." }).count()) !== 1) {
      fail("editor footnote definition");
    }
    if ((await editor.locator("mark", { hasText: "highlighted" }).count()) !== 1) fail("editor highlight");
    await page.screenshot({ path: join(OUT, "formatting-editor.png"), fullPage: true });
    ok("editor shows callout labels, footnotes and highlights");

    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
    await page.waitForTimeout(1_000);
    const saved = readFileSync(file, "utf8");
    for (const line of [
      "> [!NOTE]\n> A GitHub note.",
      "> [!warning] Mind the **gap**",
      "> [!tip]- Folded tip",
      "==highlighted **bold** text==",
      "<kbd>Ctrl</kbd>",
      "A claim[^src].",
      "[^src]: The footnote text.",
    ]) {
      if (!saved.includes(line)) fail(`saved file lost ${JSON.stringify(line)}:\n${saved}`);
    }
    ok("saving from the editor keeps callouts, highlights, HTML and footnotes");
  },
  () => rmSync(file, { force: true }),
);
