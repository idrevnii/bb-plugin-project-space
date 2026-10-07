// Renames and deletes files and folders from the Files tree's row actions:
// a page (the open one follows its new name), a folder holding the open
// document, a rename onto an existing name (refused), a cancelled delete,
// and deleting a page, the open page, and the folder holding the open page.
// Uses only scratch-e2e-rd* paths and deletes them afterwards.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, SPACE, fail, ok, run, showFiles, spaceUrl, waitFor } from "./lib.mjs";

const PAGE = "scratch-e2e-rd-page.md";
const RENAMED = "scratch-e2e-rd-renamed.md";
const OTHER = "scratch-e2e-rd-other.md";
const DIR = "scratch-e2e-rd-dir";
const DIR_RENAMED = "scratch-e2e-rd-folder";
const CHILD = "child.md";
const ALL = [PAGE, RENAMED, OTHER, DIR, DIR_RENAMED];

const onDisk = (path) => existsSync(join(SPACE, path));
const cleanup = () => {
  for (const path of ALL) rmSync(join(SPACE, path), { recursive: true, force: true });
};

cleanup();
mkdirSync(join(SPACE, DIR), { recursive: true });
writeFileSync(join(SPACE, PAGE), "# RD page\n\nRenamed from the tree.\n");
writeFileSync(join(SPACE, OTHER), "# RD other\n\nDeleted from the tree.\n");
writeFileSync(join(SPACE, DIR, CHILD), "# RD child\n\nInside a renamed folder.\n");

await run(async ({ page }) => {
  const tree = page.locator('nav[aria-label="Space files"]');
  const row = (path) => tree.locator(`[data-tree-path="${path}"]`);
  const urlEndsWith = (path) => () => decodeURI(page.url()).endsWith(`/${path}`);
  /** Answers the next window.confirm. */
  const answerConfirm = (accept) =>
    page.once("dialog", (dialog) => void (accept ? dialog.accept() : dialog.dismiss()));
  const open = async (path, text) => {
    await page.goto(spaceUrl(path));
    await page.getByText(text).waitFor({ timeout: 20_000 });
    await showFiles(page);
    await row(path).waitFor({ timeout: 15_000 });
  };
  const action = async (path, label) => {
    await row(path).hover();
    await row(path).getByRole("button", { name: label, exact: true }).click();
  };
  const renameTo = async (path, name, label) => {
    await action(path, `Rename ${label}`);
    const input = tree.getByRole("textbox", { name: "New name" });
    await input.fill(name);
    await input.press("Enter");
  };

  // 1. Rename the open page; the document follows.
  await open(PAGE, "Renamed from the tree.");
  await renameTo(PAGE, RENAMED, PAGE);
  await waitFor("page renamed on disk", () => onDisk(RENAMED) && !onDisk(PAGE));
  await waitFor("open page follows its rename", urlEndsWith(RENAMED));
  await page.getByText("Renamed from the tree.").waitFor();
  await row(RENAMED).waitFor();
  ok("renaming the open page renames it on disk and the document follows");

  // 2. A rename onto an existing name is refused.
  await renameTo(RENAMED, OTHER, RENAMED);
  await page.getByText(`${OTHER} already exists`).waitFor({ timeout: 5_000 });
  if (!onDisk(RENAMED) || !onDisk(OTHER)) fail("a refused rename changed the space");
  ok("renaming onto an existing name is refused");

  // 3. Escape cancels a rename.
  await action(RENAMED, `Rename ${RENAMED}`);
  await tree.getByRole("textbox", { name: "New name" }).fill("scratch-e2e-rd-never.md");
  await page.keyboard.press("Escape");
  await row(RENAMED).waitFor();
  if (onDisk("scratch-e2e-rd-never.md") || !onDisk(RENAMED)) fail("Escape did not cancel the rename");
  ok("Escape cancels a rename");

  // 4. Rename the folder holding the open document.
  await open(`${DIR}/${CHILD}`, "Inside a renamed folder.");
  await renameTo(DIR, DIR_RENAMED, DIR);
  await waitFor("folder renamed on disk", () => onDisk(`${DIR_RENAMED}/${CHILD}`) && !onDisk(DIR));
  await waitFor("open document follows its folder's rename", urlEndsWith(`${DIR_RENAMED}/${CHILD}`));
  await page.getByText("Inside a renamed folder.").waitFor();
  await row(`${DIR_RENAMED}/${CHILD}`).waitFor();
  ok("renaming a folder moves the open document inside it");

  // 5. A cancelled delete keeps the file.
  answerConfirm(false);
  await action(OTHER, `Delete ${OTHER}`);
  await page.waitForTimeout(1_000);
  if (!onDisk(OTHER)) fail("a cancelled delete removed the file");
  ok("cancelling the delete prompt keeps the file");

  // 6. Delete a page that is not open; the open document stays.
  answerConfirm(true);
  await action(OTHER, `Delete ${OTHER}`);
  await waitFor("page deleted on disk", () => !onDisk(OTHER));
  await row(OTHER).waitFor({ state: "detached" });
  if (!urlEndsWith(`${DIR_RENAMED}/${CHILD}`)()) fail("deleting another page moved the open document");
  ok("deleting a page removes it from disk and the tree");

  // 7. Delete the folder holding the open document: the space's start page opens.
  answerConfirm(true);
  await action(DIR_RENAMED, `Delete ${DIR_RENAMED}`);
  await waitFor("folder deleted on disk", () => !onDisk(DIR_RENAMED));
  await row(DIR_RENAMED).waitFor({ state: "detached" });
  await waitFor("start page opens after its folder is deleted", () => !decodeURI(page.url()).includes(DIR_RENAMED));
  await page.screenshot({ path: join(OUT, "tree-delete-folder.png") });
  ok("deleting the folder of the open document leaves for the start page");

  // 8. Delete the open page itself.
  await open(RENAMED, "Renamed from the tree.");
  answerConfirm(true);
  await action(RENAMED, `Delete ${RENAMED}`);
  await waitFor("open page deleted on disk", () => !onDisk(RENAMED));
  await waitFor("start page opens after the open page is deleted", () => !decodeURI(page.url()).includes(RENAMED));
  if (await page.getByText("does not exist (any more)").isVisible()) fail("a deleted page is left open");
  ok("deleting the open page leaves for the start page");
}, cleanup);
