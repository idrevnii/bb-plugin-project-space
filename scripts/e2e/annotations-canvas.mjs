// Annotating a canvas: select two boxes, *Comment*, save with Ctrl/⌘+Enter.
// A numbered badge sits at the top-right of the boxes and is still there
// after a reload; `bb space canvas` prints the comment under the box. Moving
// the boxes moves the badge; the context menu offers *Comment* too. Clicking
// the badge, or the comment in the Review tab, opens the comment. Deleting the boxes lists the comment as
// orphaned in the corner, where it can be deleted. Cleans up its scratch
// canvas and annotations.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OUT, PROJECT_ID, SPACE, bb, fail, ok, panel, run, spaceUrl, waitFor } from "./lib.mjs";

const PATH = "scratch-e2e-annotate.tldr";
const COMMENT = "These two should be one service";
const specDir = mkdtempSync(join(tmpdir(), "space-e2e-"));
const inputFile = join(specDir, "input.json");
const removeScratch = () => {
  rmSync(join(SPACE, PATH), { force: true });
  rmSync(join(SPACE, ".space", "annotations", `${PATH}.json`), { force: true });
};
const cleanup = () => {
  removeScratch();
  rmSync(specDir, { recursive: true, force: true });
};

function list() {
  writeFileSync(inputFile, JSON.stringify({ projectId: PROJECT_ID, path: PATH }));
  return JSON.parse(bb("plugin", "rpc", "call", "project-space", "annotations_list", "--input-file", inputFile, "--json"))
    .annotations;
}

const describe = () => bb("space", "canvas", PATH, "--project", PROJECT_ID);

/** Screen box of a shape, from tldraw's DOM. */
async function shapeBox(page, id) {
  const box = await panel(page).locator(`.tl-shape[data-shape-id="shape:node-${id}"]`).boundingBox();
  if (box === null) fail(`shape ${id} is not on screen`);
  return box;
}

/** The union of the two boxes' screen rects. */
async function union(page) {
  const [a, b] = [await shapeBox(page, "a"), await shapeBox(page, "b")];
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return { left, top, right: Math.max(a.x + a.width, b.x + b.width), bottom: Math.max(a.y + a.height, b.y + b.height) };
}

async function badgeCenter(badge) {
  const box = await badge.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The badge sits on the top-right corner of the boxes' bounds (once the camera settles). */
async function expectOnCorner(page, badge, what) {
  let seen = "";
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const bounds = await union(page);
    const center = await badgeCenter(badge);
    if (Math.abs(center.x - bounds.right) <= 6 && Math.abs(center.y - bounds.top) <= 6) return;
    seen = `badge at (${center.x}, ${center.y}), corner at (${bounds.right}, ${bounds.top})`;
    await page.waitForTimeout(100);
  }
  fail(`${what}: ${seen}`);
}

async function selectBoth(page) {
  const a = await shapeBox(page, "a");
  const b = await shapeBox(page, "b");
  await page.mouse.click(a.x + 8, a.y + 8);
  await page.keyboard.down("Shift");
  await page.mouse.click(b.x + 8, b.y + 8);
  await page.keyboard.up("Shift");
}

removeScratch();

await run(async ({ page }) => {
  const body = panel(page);
  // The Space page hosts the renderer that lands the drawing.
  await page.goto(spaceUrl("index.md"));
  await page.locator("h1").first().waitFor({ timeout: 20_000 });
  const spec = join(specDir, "spec.json");
  writeFileSync(
    spec,
    JSON.stringify({
      clear: true,
      nodes: [
        { id: "a", label: "E2E box A" },
        { id: "b", label: "E2E box B" },
        { id: "c", label: "E2E box C" },
      ],
      edges: [{ from: "a", to: "c" }],
    }),
  );
  const drawn = bb("space", "draw", PATH, "--project", PROJECT_ID, "--spec-file", spec);
  if (!drawn.startsWith("Drew on")) fail(`draw did not land:\n${drawn}`);

  await page.goto(spaceUrl(PATH));
  await body.getByText("E2E box B").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);

  // 1. Select two boxes → Comment → save.
  await selectBoth(page);
  const comment = body.getByRole("button", { name: "Comment", exact: true });
  await comment.waitFor({ timeout: 5_000 });
  await page.screenshot({ path: join(OUT, "annotations-canvas-select.png") });
  await comment.click();
  const dialog = page.getByRole("dialog", { name: "New comment" });
  await dialog.waitFor({ timeout: 5_000 });
  if (!(await dialog.getByText("On 2 shapes").isVisible())) fail("the new comment does not say it is on 2 shapes");
  await dialog.getByRole("textbox", { name: "Comment" }).fill(COMMENT);
  await page.keyboard.press("Control+Enter");
  await dialog.waitFor({ state: "hidden", timeout: 5_000 });
  const saved = list();
  if (saved.length !== 1) fail(`expected 1 annotation, got ${saved.length}`);
  const ids = [...saved[0].anchor.shapeIds].sort();
  if (saved[0].anchor.kind !== "shapes" || ids.join() !== "shape:node-a,shape:node-b") {
    fail(`the anchor is not the two boxes: ${JSON.stringify(saved[0].anchor)}`);
  }
  const badge = body.getByTestId("canvas-annotation-badge");
  await badge.waitFor({ timeout: 5_000 });
  if ((await badge.textContent()) !== "1") fail(`the badge reads ${await badge.textContent()}`);
  await expectOnCorner(page, badge, "after saving");
  await page.screenshot({ path: join(OUT, "annotations-canvas-badge.png") });
  ok("select two boxes → Comment → a badge on their top-right corner");

  // 2. Reload: the badge is back.
  await page.reload();
  await body.getByText("E2E box B").first().waitFor({ timeout: 20_000 });
  await badge.waitFor({ timeout: 10_000 });
  await expectOnCorner(page, badge, "after a reload");
  ok("the badge is there after a reload");

  // 3. Agents see the comment beside the node.
  const text = describe().split("\n");
  const node = text.findIndex((line) => line.startsWith('- id "a"') || line.startsWith('- id "b"'));
  if (node === -1 || !text[node + 1]?.includes(`comment ${saved[0].id} [open]`) || !text[node + 1].includes(COMMENT)) {
    fail(`bb space canvas does not show the comment under the node:\n${text.join("\n")}`);
  }
  ok("bb space canvas prints the comment under the node");

  // 4. Click the badge: the comment opens; Esc closes it.
  await badge.click();
  const card = page.getByRole("dialog", { name: "Comment" });
  await card.getByText(COMMENT).waitFor({ timeout: 5_000 });
  await page.keyboard.press("Escape");
  await card.waitFor({ state: "hidden", timeout: 5_000 });
  ok("clicking the badge opens the comment");

  // 4b. From the Review tab on another page: the canvas opens with the comment.
  await page.goto(spaceUrl("index.md"));
  await page.locator("h1").first().waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Review" })
    .locator(`[data-review-path="${PATH}"] li`)
    .getByRole("button")
    .first()
    .click();
  await card.getByText(COMMENT).waitFor({ timeout: 15_000 });
  await expectOnCorner(page, badge, "after opening from the Review tab");
  await page.screenshot({ path: join(OUT, "annotations-canvas-open.png") });
  await page.keyboard.press("Escape");
  await card.waitFor({ state: "hidden", timeout: 5_000 });
  ok("clicking the comment in the Review tab opens the canvas with the comment");

  // 5. Move the boxes: the badge follows.
  await selectBoth(page);
  const before = await badgeCenter(badge);
  const a = await shapeBox(page, "a");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 160, a.y + a.height / 2 + 90, { steps: 10 });
  await page.mouse.up();
  await waitFor("the badge to move", async () => {
    const now = await badgeCenter(badge);
    return Math.abs(now.x - before.x - 160) < 4 && Math.abs(now.y - before.y - 90) < 4;
  });
  await expectOnCorner(page, badge, "after moving the boxes");
  ok("moving the boxes moves the badge");

  // 6. The context menu offers Comment for a selection.
  await page.mouse.click((await shapeBox(page, "c")).x + 8, (await shapeBox(page, "c")).y + 8, { button: "right" });
  const item = page.getByRole("menuitem", { name: "Comment" });
  await item.waitFor({ timeout: 5_000 });
  await page.keyboard.press("Escape");
  ok("the context menu offers Comment");

  // 7. Delete the boxes: the comment is listed as orphaned.
  await page.keyboard.press("Escape");
  await selectBoth(page);
  await page.keyboard.press("Delete");
  await badge.waitFor({ state: "detached", timeout: 5_000 });
  const orphans = body.getByTestId("orphaned-annotations");
  await orphans.getByText(COMMENT).waitFor({ timeout: 5_000 });
  await page.screenshot({ path: join(OUT, "annotations-canvas-orphaned.png") });
  await waitFor("the deletion saved", () => !describe().includes('"E2E box A"'));
  if (!describe().includes(`no longer on the board: comment ${saved[0].id}`)) {
    fail(`bb space canvas does not list the orphaned comment:\n${describe()}`);
  }
  ok("deleting the boxes lists the comment as orphaned, for agents too");

  // 8. Open it from the list and delete it.
  await orphans.getByText(COMMENT).click();
  await card.getByRole("button", { name: "Delete" }).click();
  await orphans.waitFor({ state: "detached", timeout: 5_000 });
  await waitFor("the annotation deleted", () => list().length === 0);
  ok("an orphaned comment can be deleted from the list");
}, cleanup);
