// Canvas conflicts: the user draws while an agent rewrites the .tldr file
// (with file tools, not `bb space draw`, which merges into the open board).
//   1. Unsaved strokes + a rewrite → the conflict card; *Load theirs* shows
//      the agent's board and leaves the file alone.
//   2. Same, *Keep mine* writes the board over the agent's file.
//   3. The rewrite lands while the board's save is in flight → the card,
//      and *Keep mine* still has the user's last box.
//   4. The board's own save echoing back while the user keeps drawing is
//      not a conflict.
// Deletes its scratch-e2e-cc* canvases afterwards.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OUT, PROJECT_ID, SPACE, bb, fail, ok, panel, run, spaceUrl, waitFor } from "./lib.mjs";

const PATH = "scratch-e2e-cc.tldr";
const THEIRS = "scratch-e2e-cc-theirs.tldr";
const specDir = mkdtempSync(join(tmpdir(), "space-e2e-"));
const disk = () => readFileSync(join(SPACE, PATH), "utf8");
const geoCount = (json) => (json.match(/"type":"geo"/g) ?? []).length;
const cleanup = () => {
  for (const path of [PATH, THEIRS]) rmSync(join(SPACE, path), { force: true });
  rmSync(specDir, { recursive: true, force: true });
};

/** A canvas file as an agent would produce it, with one labelled box. */
function agentCanvas(label) {
  const spec = join(specDir, "spec.json");
  writeFileSync(spec, JSON.stringify({ clear: true, nodes: [{ id: "agent", label }] }));
  bb("space", "draw", THEIRS, "--project", PROJECT_ID, "--spec-file", spec);
  return readFileSync(join(SPACE, THEIRS), "utf8");
}

/** Picks the rectangle tool and drags a box at an offset from the middle. */
async function drawBox(page, offset) {
  const board = page.locator(".tl-container").first();
  const box = await board.boundingBox();
  await board.click({ position: { x: 60, y: box.height - 120 } });
  await page.keyboard.press("r");
  const x = box.x + 120 + offset * 30;
  const y = box.y + 140 + offset * 30;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 60, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

for (const path of [PATH, THEIRS]) rmSync(join(SPACE, path), { force: true });

await run(async ({ page }) => {
  const card = page.getByText("The file changed on disk while you were drawing.");
  const status = (text) => panel(page).getByText(text, { exact: true });

  // The Space page hosts the renderer that lands the agent drawings.
  await page.goto(spaceUrl("index.md"));
  await page.locator("h1").first().waitFor({ timeout: 20_000 });
  const theirsA = agentCanvas("Agent A");
  const theirsB = agentCanvas("Agent B");
  const theirsC = agentCanvas("Agent C");
  writeFileSync(join(SPACE, PATH), agentCanvas("Base"));

  // Set up after the agent drawings, which the renderer writes through it.
  /** Holds space_write back, before it reaches the server or after. */
  let hold = { ms: 0, stage: "request" };
  let writes = 0;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await page.route("**/rpc/space_write", async (route) => {
    writes += 1;
    const { ms, stage } = hold;
    if (stage === "request") await sleep(ms);
    const response = await route.fetch();
    if (stage === "response") await sleep(ms);
    await route.fulfill({ response });
  });
  /** Delays reads, so the page learns of a write only after the user drew on. */
  let readDelay = 0;
  await page.route("**/rpc/space_read", async (route) => {
    const ms = readDelay;
    const response = await route.fetch();
    await sleep(ms);
    await route.fulfill({ response });
  });
  await page.goto(spaceUrl(PATH));
  await page.locator(".tl-container").first().waitFor({ timeout: 20_000 });
  await page.getByText("Base").first().waitFor({ timeout: 20_000 });

  // 1. Load theirs.
  await drawBox(page, 0);
  writeFileSync(join(SPACE, PATH), theirsA);
  await card.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(1_500);
  if (disk() !== theirsA) fail("unsaved strokes were saved over the agent's rewrite");
  await page.screenshot({ path: join(OUT, "canvas-conflict.png") });
  await page.getByRole("button", { name: "Load theirs" }).click();
  await card.waitFor({ state: "hidden", timeout: 5_000 });
  await page.getByText("Agent A").first().waitFor({ timeout: 5_000 });
  await status("Saved").waitFor({ timeout: 5_000 });
  await page.waitForTimeout(1_500);
  if (disk() !== theirsA) fail("Load theirs changed the file");
  ok("a rewrite under unsaved strokes shows the card; Load theirs shows the agent's board");

  // 2. Keep mine.
  await drawBox(page, 1);
  writeFileSync(join(SPACE, PATH), theirsB);
  await card.waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Keep mine" }).click();
  await waitFor("Keep mine on disk", () => disk() !== theirsB);
  if (!disk().includes("Agent A") || disk().includes("Agent B") || geoCount(disk()) !== 2) {
    fail(`Keep mine did not write the board (Agent A + one box): ${geoCount(disk())} boxes`);
  }
  await card.waitFor({ state: "hidden", timeout: 5_000 });
  ok("Keep mine writes the board over the agent's rewrite");

  // 3. The rewrite lands while the save is on its way to the server.
  hold = { ms: 3_000, stage: "request" };
  const before = writes;
  await drawBox(page, 2);
  await waitFor("the board's save to start", () => writes > before);
  writeFileSync(join(SPACE, PATH), theirsC);
  await card.waitFor({ timeout: 10_000 });
  hold = { ms: 0, stage: "request" };
  await page.getByRole("button", { name: "Keep mine" }).click();
  await waitFor("Keep mine after an in-flight save", () => disk() !== theirsC);
  if (disk().includes("Agent C") || geoCount(disk()) !== 3) {
    fail(`the board lost the user's box while its save was in flight: ${geoCount(disk())} boxes, Agent C ${disk().includes("Agent C")}`);
  }
  ok("a rewrite during an in-flight save still conflicts, and Keep mine keeps the last box");

  // 4. The board's own save echoes back (its response held) while the user
  // keeps drawing.
  await status("Saved").waitFor({ timeout: 10_000 });
  hold = { ms: 3_000, stage: "response" };
  readDelay = 1_500;
  const start = writes;
  const boxes = geoCount(disk());
  await drawBox(page, 3);
  await waitFor("the board's save to start", () => writes > start);
  await drawBox(page, 4);
  hold = { ms: 0, stage: "request" };
  readDelay = 0;
  await waitFor("both boxes saved", () => geoCount(disk()) === boxes + 2, 20_000);
  await page.waitForTimeout(1_500);
  if (await card.isVisible()) fail("the board's own save was taken for an outside change");
  await status("Saved").waitFor({ timeout: 10_000 });
  ok("the board's own save echoing back mid-drawing is not a conflict");
}, cleanup);
