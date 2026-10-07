// The *File tree position* setting = left: the tree sits beside the document
// instead of in bb's right panel; the Files tab says where it went; opening,
// creating and the active row work there; a canvas still fills the rest; and
// flipping the setting back moves the tree without a reload. Restores the
// setting and deletes its scratch-e2e-left* files afterwards.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, SPACE, bb, fail, ok, run, showFiles, spaceUrl, waitFor } from "./lib.mjs";

const PAGE = "scratch-e2e-left.md";
const CREATED = "scratch-e2e-left-new";
const CANVAS = "architecture/diagram.tldr";

const setting = () => /treePosition = "(\w+)"/.exec(bb("plugin", "config", "project-space"))?.[1] ?? "right";
const setPosition = (value) => bb("plugin", "config", "project-space", "set", "treePosition", value);
const before = setting();
const cleanup = () => {
  setPosition(before);
  for (const path of [PAGE, `${CREATED}.md`]) rmSync(join(SPACE, path), { force: true });
};

cleanup();
writeFileSync(join(SPACE, PAGE), "# Left tree\n\nThe tree is on the left.\n");
setPosition("left");

await run(async ({ page }) => {
  const tree = page.locator('nav[aria-label="Space files"]');
  // ProjectSpace's own column, not bb's right panel (also an <aside>).
  const aside = page.locator("aside.w-64").filter({ has: tree });
  const row = (path) => tree.locator(`[data-tree-path="${path}"]`);

  await page.goto(spaceUrl(PAGE));
  await page.getByText("The tree is on the left.").waitFor({ timeout: 20_000 });
  await aside.waitFor({ timeout: 10_000 });
  const treeBox = await aside.boundingBox();
  const textBox = await page.getByText("The tree is on the left.").boundingBox();
  if (treeBox.x + treeBox.width > textBox.x) fail("the tree is not left of the document");
  if (await page.getByRole("button", { name: "Show files" }).isVisible()) fail("Show files is offered with the tree on the left");
  await waitFor("the open page's row to be highlighted", async () => (await row(PAGE).getByRole("button").first().getAttribute("aria-current")) === "page");
  await page.screenshot({ path: join(OUT, "tree-left.png") });
  ok("the tree sits left of the document, the open page highlighted, no Show files button");

  // bb's right panel, if open, explains where the tree went.
  const filesTab = page.getByRole("button", { name: "Files", exact: true });
  if (await filesTab.isVisible()) {
    await filesTab.click();
    await page.getByText("The file tree is beside the document.").waitFor({ timeout: 5_000 });
    ok("the Files tab points at the tree beside the document");
  }

  // Opening and creating from the left tree.
  await row("index.md").click();
  await page.waitForURL((url) => decodeURI(url.toString()).endsWith("/index.md"));
  await waitFor("the highlight to follow", async () => (await row("index.md").getByRole("button").first().getAttribute("aria-current")) === "page");
  await tree.locator("..").getByRole("button", { name: "New…" }).click();
  await page.getByRole("menuitem", { name: "Page" }).click();
  const input = page.getByRole("textbox", { name: "New page name" });
  await input.fill(CREATED);
  await input.press("Enter");
  await waitFor("new page on disk", () => existsSync(join(SPACE, `${CREATED}.md`)));
  await page.waitForURL((url) => decodeURI(url.toString()).endsWith(`/${CREATED}.md`));
  ok("a row click opens the page and New… creates and opens one");

  // A canvas fills the space right of the tree.
  await page.goto(spaceUrl(CANVAS));
  const canvas = page.locator(".tl-container").first();
  await canvas.waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1_000);
  const canvasBox = await canvas.boundingBox();
  const asideBox = await aside.boundingBox();
  if (canvasBox.x < asideBox.x + asideBox.width - 1) fail("the canvas overlaps the tree");
  const column = await aside.evaluate((element) => element.nextElementSibling.getBoundingClientRect().width);
  if (canvasBox.width < column - 2 || canvasBox.height < 400) {
    fail(`the canvas is ${canvasBox.width}×${canvasBox.height} in a ${column} px column`);
  }
  await page.screenshot({ path: join(OUT, "tree-left-canvas.png") });
  ok("a canvas fills the space right of the tree");

  // Back to the right without a reload.
  setPosition("right");
  await aside.waitFor({ state: "detached", timeout: 15_000 });
  await showFiles(page);
  ok("switching the setting back moves the tree to the right panel live");
}, cleanup);
