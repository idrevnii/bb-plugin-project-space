// Moves files and folders in the Files tree by drag and drop and with the
// Move to… picker: a page into a folder and back to the root, a folder with
// the open document inside it (the page follows), and an illegal drop (a
// folder into its own child) that is refused. Also checks that no bb split
// drag starts. Uses only scratch-e2e-dnd* paths and deletes them afterwards.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, SPACE, fail, ok, run, spaceUrl, waitFor } from "./lib.mjs";

const FOLDER = "scratch-e2e-dnd";
const SUB = `${FOLDER}/scratch-e2e-dnd-sub`;
const PAGE = "scratch-e2e-dnd-page.md";
const DIR = "scratch-e2e-dnd-dir";
const CHILD = `${DIR}/child.md`;

const onDisk = (path) => existsSync(join(SPACE, path));
const cleanup = () => {
  for (const path of [FOLDER, PAGE, DIR]) rmSync(join(SPACE, path), { recursive: true, force: true });
};

cleanup();
mkdirSync(join(SPACE, SUB), { recursive: true });
mkdirSync(join(SPACE, DIR), { recursive: true });
writeFileSync(join(SPACE, PAGE), "# DnD page\n\nMoved by drag and drop.\n");
writeFileSync(join(SPACE, CHILD), "# DnD child\n\nInside a dragged folder.\n");

await run(async ({ page }) => {
  const tree = page.locator('nav[aria-label="Space files"]');
  const row = (path) => tree.locator(`[data-tree-path="${path}"]`);
  const urlEndsWith = (path) => () => decodeURI(page.url()).endsWith(`/${path}`);

  // Record any bb split-drag ghost; a tree drag must never start one.
  await page.addInitScript(() => {
    window.__splitDrag = false;
    new MutationObserver(() => {
      if (document.querySelector("[data-split-drag-ghost],[data-split-drag-label]")) window.__splitDrag = true;
    }).observe(document, { childList: true, subtree: true });
  });

  await page.goto(spaceUrl(PAGE));
  await page.getByText("Moved by drag and drop.").waitFor({ timeout: 20_000 });
  if (!(await tree.isVisible())) await page.getByRole("button", { name: "Show files" }).click();
  await row(PAGE).waitFor({ timeout: 15_000 });

  // 1. A page into a folder; the open page follows.
  await row(PAGE).dragTo(row(FOLDER));
  await waitFor("page moved into folder", () => onDisk(`${FOLDER}/${PAGE}`) && !onDisk(PAGE));
  await waitFor("open page follows into folder", urlEndsWith(`${FOLDER}/${PAGE}`));
  ok("page dragged into a folder; the open document follows");

  // 2. Back to the root by dropping on the empty area below the tree.
  await row(`${FOLDER}/${PAGE}`).waitFor();
  const box = await tree.boundingBox();
  await row(`${FOLDER}/${PAGE}`).dragTo(tree, { targetPosition: { x: 40, y: box.height - 20 } });
  await waitFor("page moved back to the root", () => onDisk(PAGE) && !onDisk(`${FOLDER}/${PAGE}`));
  await waitFor("open page follows to the root", urlEndsWith(PAGE));
  ok("page dragged back to the root");

  // 3. A folder holding the open document.
  await page.goto(spaceUrl(CHILD));
  await page.getByText("Inside a dragged folder.").waitFor({ timeout: 20_000 });
  if (!(await tree.isVisible())) await page.getByRole("button", { name: "Show files" }).click();
  await row(DIR).waitFor({ timeout: 15_000 });
  await row(DIR).dragTo(row(FOLDER));
  await waitFor("folder moved", () => onDisk(`${FOLDER}/${CHILD}`) && !onDisk(DIR));
  await waitFor("open document follows its folder", urlEndsWith(`${FOLDER}/${CHILD}`));
  await page.getByText("Inside a dragged folder.").waitFor();
  await page.screenshot({ path: join(OUT, "tree-dnd-folder.png") });
  ok("folder dragged; the open document inside it follows");

  // 4. Illegal: a folder into its own subfolder is refused with a toast.
  await row(SUB).waitFor();
  await row(FOLDER).dragTo(row(SUB));
  await page.getByText(/into itself/).waitFor({ timeout: 5_000 });
  if (!onDisk(SUB) || !onDisk(`${FOLDER}/${CHILD}`)) fail("illegal drop changed the space");
  ok("dropping a folder into its own subfolder is refused");

  // 5. Keyboard alternative: Move to… picker.
  await row(PAGE).hover();
  await page.getByRole("button", { name: `Move ${PAGE} to…` }).click();
  const dialog = page.getByRole("dialog", { name: `Move ${PAGE} to…` });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: FOLDER, exact: true }).focus();
  await page.keyboard.press("Enter");
  await waitFor("Move to… moved the page", () => onDisk(`${FOLDER}/${PAGE}`) && !onDisk(PAGE));
  ok("Move to… moves a page into the picked folder");

  if (await page.evaluate(() => window.__splitDrag)) fail("a tree drag started a bb split drag");
  ok("no bb split drag started");
}, cleanup);
