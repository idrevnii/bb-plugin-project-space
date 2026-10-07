// Opens a Markdown page, an HTML report and a tldraw canvas; fails on page
// errors and saves a screenshot of each to scripts/e2e/out/. Opening the
// canvas must leave its file as it was.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, SPACE, fail, ok, panel, run, spaceUrl } from "./lib.mjs";

const MARKDOWN = process.env.SMOKE_MD ?? "index.md";
const HTML = process.env.SMOKE_HTML ?? "reports/status.html";
const CANVAS = process.env.SMOKE_TLDR ?? "architecture/diagram.tldr";

await run(async ({ page }) => {
  await page.goto(spaceUrl(MARKDOWN));
  await page.locator("article h1, h1").first().waitFor({ timeout: 20_000 });
  await page.screenshot({ path: join(OUT, "smoke-markdown.png") });
  ok(`${MARKDOWN} renders`);

  await page.goto(spaceUrl(HTML));
  const frame = page.locator("iframe").first();
  await frame.waitFor({ timeout: 20_000 });
  await frame.contentFrame().locator("body *").first().waitFor({ timeout: 20_000 });
  await page.screenshot({ path: join(OUT, "smoke-html.png") });
  ok(`${HTML} renders in a frame`);

  const canvasBefore = readFileSync(join(SPACE, CANVAS), "utf8");
  await page.goto(spaceUrl(CANVAS));
  await panel(page).locator(".tl-canvas").waitFor({ timeout: 20_000 });
  await panel(page).locator(".tl-shape").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, "smoke-tldraw.png") });
  ok(`${CANVAS} renders ${await panel(page).locator(".tl-shape").count()} shapes`);
  // Past the editor's save delay: viewing alone must not rewrite the file.
  await page.waitForTimeout(1500);
  if (readFileSync(join(SPACE, CANVAS), "utf8") !== canvasBefore) fail(`opening ${CANVAS} rewrote it`);
  ok(`opening ${CANVAS} leaves the file untouched`);
});
