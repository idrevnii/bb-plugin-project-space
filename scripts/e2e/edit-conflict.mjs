// The edit conflict banner: while a page is being edited, someone (an agent)
// changes it on disk. The banner appears; Save keeps it (the compare-and-swap
// write is refused); *Discard mine* loads the disk version into the editor;
// *Overwrite* writes the draft over the disk version. Once in the WYSIWYG
// editor and once in Source. Deletes its scratch page afterwards.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, SPACE, fail, ok, panel, run, spaceUrl, waitFor } from "./lib.mjs";

const PATH = "scratch-e2e-conflict.md";
const file = join(SPACE, PATH);
const disk = () => readFileSync(file, "utf8");
const BANNER = "This file changed on disk since you started editing.";

writeFileSync(file, "# Conflict e2e\n\nOriginal line.\n");

await run(async ({ page }) => {
  const body = panel(page);
  const banner = body.getByText(BANNER);
  const save = () => body.getByRole("button", { name: "Save", exact: true }).click();

  await page.goto(spaceUrl(PATH));
  await body.getByText("Original line.").waitFor({ timeout: 20_000 });

  // 1. WYSIWYG: type, the file changes on disk, Save is refused, Discard mine.
  await body.getByRole("button", { name: "Edit" }).click();
  const editor = body.locator(".ProseMirror");
  await editor.getByText("Original line.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Mine one.");
  writeFileSync(file, "# Conflict e2e\n\nTheirs one.\n");
  await banner.waitFor({ timeout: 10_000 });
  ok("an outside change while editing shows the banner");

  await save();
  await page.waitForTimeout(1_000);
  if (!disk().includes("Theirs one.") || disk().includes("Mine one.")) fail("Save wrote over the outside change");
  if (!(await banner.isVisible())) fail("the banner went away after a refused save");
  ok("Save is refused and the banner stays");

  await body.getByRole("button", { name: "Discard mine" }).click();
  await banner.waitFor({ state: "hidden", timeout: 5_000 });
  await editor.getByText("Theirs one.").waitFor({ timeout: 5_000 });
  if ((await editor.innerText()).includes("Mine one.")) fail("Discard mine kept the draft in the editor");
  if (!disk().includes("Theirs one.")) fail("Discard mine changed the file");
  await body.getByText("Saved", { exact: true }).waitFor({ timeout: 5_000 });
  ok("Discard mine loads the disk version into the editor and leaves the file alone");

  // Still editing after the discard: a normal save goes through.
  await editor.getByText("Theirs one.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Then mine.");
  await save();
  await waitFor("save after discard", () => disk().includes("Theirs one. Then mine."));
  ok("after Discard mine, the next save writes normally");

  // 2. Overwrite, after a refused save.
  await editor.getByText("Then mine.").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Mine two.");
  writeFileSync(file, "# Conflict e2e\n\nTheirs two.\n");
  await banner.waitFor({ timeout: 10_000 });
  await save();
  await page.waitForTimeout(500);
  await body.getByRole("button", { name: "Overwrite" }).click();
  await waitFor("overwrite on disk", () => disk().includes("Then mine. Mine two."));
  await banner.waitFor({ state: "hidden", timeout: 5_000 });
  await body.getByText("Saved", { exact: true }).waitFor({ timeout: 5_000 });
  await page.waitForTimeout(1_500);
  if (await banner.isVisible()) fail("the banner came back after Overwrite");
  ok("Overwrite writes the draft over the outside change and clears the banner");

  // 3. Source mode: Overwrite without a refused save first.
  await body.getByRole("button", { name: "Source" }).click();
  const source = body.locator("textarea");
  await source.waitFor({ timeout: 5_000 });
  await source.fill("# Conflict e2e\n\nSource draft.\n");
  writeFileSync(file, "# Conflict e2e\n\nTheirs three.\n");
  await banner.waitFor({ timeout: 10_000 });
  await page.screenshot({ path: join(OUT, "edit-conflict.png") });
  await body.getByRole("button", { name: "Overwrite" }).click();
  await waitFor("source overwrite on disk", () => disk() === "# Conflict e2e\n\nSource draft.\n");
  await banner.waitFor({ state: "hidden", timeout: 5_000 });
  ok("in Source, Overwrite writes the textarea over the outside change");

  // 4. Source mode: Discard mine replaces the textarea.
  await source.fill("# Conflict e2e\n\nSource draft two.\n");
  writeFileSync(file, "# Conflict e2e\n\nTheirs four.\n");
  await banner.waitFor({ timeout: 10_000 });
  await body.getByRole("button", { name: "Discard mine" }).click();
  await waitFor("textarea shows the disk version", async () => (await source.inputValue()).includes("Theirs four."));
  if (disk() !== "# Conflict e2e\n\nTheirs four.\n") fail("Discard mine in Source changed the file");
  ok("in Source, Discard mine loads the disk version into the textarea");

  // Done leaves the reader on the disk version.
  await body.getByRole("button", { name: "Done" }).click();
  await body.getByText("Theirs four.").waitFor({ timeout: 5_000 });
  ok("Done shows the disk version in the reader");
}, () => rmSync(file, { force: true }));
