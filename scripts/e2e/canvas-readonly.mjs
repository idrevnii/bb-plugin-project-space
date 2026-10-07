// A canvas whose file tldraw cannot load is read-only: drawing on it by hand
// must not save over the file. Once the file is fixed on disk the board loads
// and saves again. Deletes the canvas afterwards.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OUT, PROJECT_ID, SPACE, bb, fail, ok, run, spaceUrl, waitFor } from "./lib.mjs";

const PATH = "scratch-e2e-readonly.tldr";
const BROKEN = '{"records":[]}';
const specDir = mkdtempSync(join(tmpdir(), "space-e2e-"));
const onDisk = () => readFileSync(join(SPACE, PATH), "utf8");

/** Picks the rectangle tool and drags a box in the middle of the board. */
async function drawBox(page) {
  const board = page.locator(".tl-container").first();
  const box = await board.boundingBox();
  // Focus the board on empty canvas, clear of the page menu in its corner.
  await board.click({ position: { x: box.width / 2, y: box.height - 120 } });
  await page.keyboard.press("r");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 160, y + 100, { steps: 8 });
  await page.mouse.up();
}

await run(
  async ({ page }) => {
    const specFile = join(specDir, "spec.json");
    writeFileSync(specFile, JSON.stringify({ clear: true, nodes: [{ id: "ro", label: "Read-only check" }] }));
    // The Space page hosts the renderer that lands the first draw.
    await page.goto(spaceUrl("index.md"));
    await page.locator("h1").first().waitFor({ timeout: 20_000 });
    bb("space", "draw", PATH, "--project", PROJECT_ID, "--spec-file", specFile);
    const valid = onDisk();

    writeFileSync(join(SPACE, PATH), BROKEN);
    await page.goto(spaceUrl(PATH));
    const banner = page.getByText("Editing is off until it is fixed");
    await banner.waitFor({ timeout: 20_000 });
    await drawBox(page);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(OUT, "canvas-readonly.png") });
    if (onDisk() !== BROKEN) fail("drawing on an unloadable canvas saved over the file");
    ok("an unloadable canvas is read-only; the file is untouched");

    writeFileSync(join(SPACE, PATH), valid);
    await banner.waitFor({ state: "detached", timeout: 15_000 });
    await drawBox(page);
    await waitFor("the fixed canvas to save a hand-drawn box", () => onDisk() !== valid);
    if (!onDisk().includes('"geo"')) fail("saved canvas has no geo shape");
    if (onDisk().includes('"typeName":"user"')) fail("saved canvas holds a browser user record");
    ok("once the file is fixed the board loads and saves again");
  },
  () => {
    rmSync(join(SPACE, PATH), { force: true });
    rmSync(specDir, { recursive: true, force: true });
  },
);
