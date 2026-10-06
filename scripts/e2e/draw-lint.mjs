// `bb space draw` of a deliberately overlapping spec: the result must end with
// an Overlaps section naming the pair and the fix hint, and a clean redraw
// must report none. Deletes the canvas afterwards.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROJECT_ID, SPACE, bb, fail, ok, run, spaceUrl } from "./lib.mjs";

const PATH = "scratch-e2e-lint.tldr";
const specDir = mkdtempSync(join(tmpdir(), "space-e2e-"));

function draw(name, spec) {
  const specFile = join(specDir, `${name}.json`);
  writeFileSync(specFile, JSON.stringify(spec));
  const out = bb("space", "draw", PATH, "--project", PROJECT_ID, "--spec-file", specFile);
  if (!out.startsWith("Drew on")) fail(`draw (${name}) did not land:\n${out}`);
  return out;
}

function boxes(bx) {
  return {
    clear: true,
    layout: "none",
    nodes: [
      { id: "lint-a", label: "A", x: 0, y: 0, w: 200, h: 100 },
      { id: "lint-b", label: "B", x: bx, y: 40, w: 200, h: 100 },
    ],
  };
}

await run(
  async ({ page }) => {
    // Any open Space page hosts the off-screen renderer that lands the batch.
    await page.goto(spaceUrl("index.md"));
    await page.locator("h1").first().waitFor({ timeout: 20_000 });

    const bad = draw("overlap", boxes(120));
    if (!/Overlaps:\n- "lint-a" and "lint-b" overlap by \d+x\d+ px/.test(bad) || !bad.includes("To fix:")) {
      fail(`overlap not reported:\n${bad}`);
    }
    ok("overlapping draw reports the pair");

    const good = draw("apart", boxes(400));
    if (!good.includes("Overlaps: none.") || good.includes("To fix:")) {
      fail(`clean draw reported overlaps:\n${good}`);
    }
    ok("clean draw reports none");
  },
  () => {
    rmSync(join(SPACE, PATH), { force: true });
    rmSync(specDir, { recursive: true, force: true });
  },
);
