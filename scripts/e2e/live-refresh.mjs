// Writes a scratch page, opens it, appends to it from disk, and expects the
// new text on screen without a reload. Deletes the page afterwards.
import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, SPACE, ok, run, spaceUrl } from "./lib.mjs";

const PATH = "scratch-e2e-live.md";
const file = join(SPACE, PATH);
const marker = `Appended from disk ${Date.now()}`;

writeFileSync(file, "# Live refresh e2e\n\nFirst paragraph.\n");
await run(
  async ({ page }) => {
    await page.goto(spaceUrl(PATH));
    await page.getByText("First paragraph.").waitFor({ timeout: 20_000 });
    appendFileSync(file, `\n${marker}\n`);
    await page.getByText(marker).waitFor({ timeout: 10_000 });
    await page.screenshot({ path: join(OUT, "live-refresh.png") });
    ok("appended text appears without reload");
  },
  () => rmSync(file, { force: true }),
);
