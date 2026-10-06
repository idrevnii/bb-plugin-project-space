// Edits a scratch page in the WYSIWYG editor: types into a table cell, ticks a
// task, adds a link, saves with Ctrl/⌘+S, and checks the file on disk. Then
// checks the Source toggle shows the same text. Deletes the page afterwards.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, SPACE, ok, panel, run, spaceUrl, waitFor } from "./lib.mjs";

const PATH = "scratch-e2e-editor.md";
const file = join(SPACE, PATH);
const INITIAL = [
  "# Editor e2e",
  "",
  "Link target here.",
  "",
  "| Name | Value |",
  "| --- | --- |",
  "| alpha | cell |",
  "",
  "- [ ] todo",
  "- [ ] keep",
  "",
  "* star list stays",
  "",
].join("\n");

writeFileSync(file, INITIAL);
await run(
  async ({ page }) => {
    const body = panel(page);
    await page.goto(spaceUrl(PATH));
    await body.getByText("Link target here.").waitFor({ timeout: 20_000 });
    await body.getByRole("button", { name: "Edit" }).click();
    const editor = body.locator(".ProseMirror");
    await editor.waitFor({ timeout: 10_000 });
    if ((await body.locator("textarea").count()) !== 0) throw new Error("Markdown should not open in the source pane");
    ok("Markdown opens in the WYSIWYG editor");

    await editor.locator("td", { hasText: "cell" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type("X");

    await editor.locator('[data-type="taskList"] > li', { hasText: "todo" }).locator('input[type="checkbox"]').check();

    await editor.getByText("Link target here.").dblclick({ position: { x: 5, y: 5 } });
    await body.getByRole("button", { name: "Link", exact: true }).click();
    await body.getByRole("textbox", { name: "Link URL" }).fill("other-page.md");
    await page.keyboard.press("Enter");

    await editor.click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
    await waitFor("the save to reach disk", () => readFileSync(file, "utf8").includes("[x] todo"));
    const saved = readFileSync(file, "utf8");
    await page.screenshot({ path: join(OUT, "markdown-editor.png") });
    const expect = (text, what) => {
      if (!saved.includes(text)) throw new Error(`${what}: expected ${JSON.stringify(text)} in\n${saved}`);
      ok(what);
    };
    expect("| alpha | cellX |", "table cell edit persists");
    expect("- [x] todo\n- [ ] keep", "ticked task persists, the other stays open");
    expect("[Link](other-page.md) target here.", "added link persists");
    // `*` bullets are written back as `-`; the rendered page is the same.
    expect("- star list stays", "untouched content survives");

    await body.getByRole("button", { name: "Source" }).click();
    const source = body.locator("textarea");
    await source.waitFor({ timeout: 5_000 });
    if ((await source.inputValue()) !== saved) throw new Error("Source pane does not show the saved text");
    ok("Source toggle shows the same text");
  },
  () => rmSync(file, { force: true }),
);
