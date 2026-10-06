// `bb space draw` into a scratch canvas twice: once with only the Space index
// open (the off-screen renderer applies it), once with the canvas itself open.
// Both drawings must land. Deletes the canvas afterwards.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OUT, PROJECT_ID, SPACE, bb, fail, ok, panel, run, spaceUrl } from "./lib.mjs";

const PATH = "scratch-e2e.tldr";
const specDir = mkdtempSync(join(tmpdir(), "space-e2e-"));

function draw(name, spec) {
  const specFile = join(specDir, `${name}.json`);
  writeFileSync(specFile, JSON.stringify(spec));
  const out = bb("space", "draw", PATH, "--project", PROJECT_ID, "--spec-file", specFile);
  if (!out.startsWith("Drew on")) fail(`draw (${name}) did not land:\n${out}`);
  return out;
}

function twoNodes(prefix) {
  return {
    nodes: [
      { id: `${prefix}-a`, label: `E2E ${prefix} source` },
      { id: `${prefix}-b`, label: `E2E ${prefix} target` },
    ],
    edges: [{ from: `${prefix}-a`, to: `${prefix}-b`, label: "flows" }],
  };
}

await run(
  async ({ page }) => {
    await page.goto(spaceUrl("index.md"));
    await page.locator("h1").first().waitFor({ timeout: 20_000 });
    draw("closed", twoNodes("closed"));
    const closed = bb("space", "canvas", PATH, "--project", PROJECT_ID);
    if (!closed.includes("E2E closed source") || !closed.includes("E2E closed target")) {
      fail(`canvas closed: nodes missing from canvas text:\n${closed}`);
    }
    ok("drew with the canvas closed");

    await page.goto(spaceUrl(PATH));
    await panel(page).locator(".tl-canvas").waitFor({ timeout: 20_000 });
    await panel(page).getByText("E2E closed source").first().waitFor({ timeout: 10_000 });
    draw("open", twoNodes("open"));
    await panel(page).getByText("E2E open target").first().waitFor({ timeout: 10_000 });
    const open = bb("space", "canvas", PATH, "--project", PROJECT_ID);
    if (!open.includes("E2E open source") || !open.includes("E2E closed source")) {
      fail(`canvas open: nodes missing from canvas text:\n${open}`);
    }
    await page.screenshot({ path: join(OUT, "draw.png") });
    ok("drew with the canvas open");
  },
  () => {
    rmSync(join(SPACE, PATH), { force: true });
    rmSync(specDir, { recursive: true, force: true });
  },
);
