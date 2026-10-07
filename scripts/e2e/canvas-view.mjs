// Canvas pictures (space_canvas_view / `bb space canvas --png`): right after a
// `bb space draw` the picture shows the new drawing, both when only the
// off-screen renderer is around and when the canvas is open. Saves the PNGs to
// scripts/e2e/out/ for a look, and deletes the canvas afterwards.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OUT, PROJECT_ID, SPACE, bb, fail, ok, run, spaceUrl } from "./lib.mjs";

const PATH = "scratch-e2e-view.tldr";
const specDir = mkdtempSync(join(tmpdir(), "space-e2e-"));

function draw(name, spec) {
  const specFile = join(specDir, `${name}.json`);
  writeFileSync(specFile, JSON.stringify(spec));
  const out = bb("space", "draw", PATH, "--project", PROJECT_ID, "--spec-file", specFile);
  if (!out.startsWith("Drew on")) fail(`draw (${name}) did not land:\n${out}`);
  if (!out.includes("space_canvas_view")) fail(`draw result does not mention space_canvas_view:\n${out}`);
}

/** `bb space canvas --png`; the PNG's width and height, and how long it took. */
function view(name) {
  const file = join(OUT, `canvas-view-${name}.png`);
  const started = Date.now();
  bb("space", "canvas", PATH, "--project", PROJECT_ID, "--png", file);
  const ms = Date.now() - started;
  const png = readFileSync(file);
  if (png.subarray(1, 4).toString() !== "PNG") fail(`${file} is not a PNG`);
  return { file, png, width: png.readUInt32BE(16), height: png.readUInt32BE(20), ms };
}

/** Runs `bb space canvas --png` expecting a refusal; its stderr. */
function viewFails(out, cwd) {
  try {
    execFileSync(process.env.BB_CLI ?? "bb", ["space", "canvas", PATH, "--project", PROJECT_ID, "--png", out], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return String(error.stderr);
  }
  fail(`expected bb space canvas --png ${out} to fail`);
}

const chain = (ids) => ({
  clear: true,
  layout: "lr",
  nodes: ids.map((id) => ({ id, label: `Step ${id}`, color: "blue" })),
  edges: ids.slice(1).map((id, i) => ({ from: ids[i], to: id })),
});

await run(
  async ({ page }) => {
    // Any open Space page hosts the off-screen renderer.
    await page.goto(spaceUrl("index.md"));
    await page.locator("h1").first().waitFor({ timeout: 20_000 });

    draw("two", chain(["a", "b"]));
    const two = view("offscreen-two");
    draw("five", chain(["a", "b", "c", "d", "e"]));
    const five = view("offscreen-five");
    if (five.png.equals(two.png)) fail("picture did not change after the second draw");
    if (five.width <= two.width) fail(`five boxes (${five.width}px) not wider than two (${two.width}px)`);
    if (five.width > 1600) fail(`picture is ${five.width}px wide, over the 1600px cap`);
    ok(`off-screen: pictures follow each draw (${two.width}x${two.height}, ${five.width}x${five.height}; ${five.ms} ms)`);

    // Hand-edit the file so the stored picture is stale: the view must ask a
    // renderer for a fresh one rather than return the old picture.
    const doc = JSON.parse(readFileSync(join(SPACE, PATH), "utf8"));
    doc.records = doc.records.filter((record) => record.id !== "shape:node-e" && record.id !== "shape:edge-d->e");
    writeFileSync(join(SPACE, PATH), JSON.stringify(doc));
    const edited = view("offscreen-edited");
    if (edited.width >= five.width) fail(`stale picture returned after a hand edit (${edited.width}px)`);
    ok(`stale picture re-rendered on request (${edited.width}x${edited.height}; ${edited.ms} ms)`);

    const inSpace = viewFails("scratch-e2e-view.png", SPACE);
    if (!inSpace.includes("not written into the space") || existsSync(join(SPACE, "scratch-e2e-view.png"))) {
      fail(`a relative --png from inside the space was not refused:\n${inSpace}`);
    }
    ok("a relative --png from inside .bb-space is refused");

    const intact = readFileSync(join(SPACE, PATH), "utf8");
    writeFileSync(join(SPACE, PATH), '{"not": "a tldr');
    const broken = viewFails(join(OUT, "canvas-view-broken.png"));
    if (!broken.includes("cannot be pictured") || !broken.includes("not a readable tldraw document")) {
      fail(`an unreadable canvas was not reported as such:\n${broken}`);
    }
    writeFileSync(join(SPACE, PATH), intact);
    ok("an unreadable canvas is reported, not pictured as empty");

    await page.goto(spaceUrl(PATH));
    await page.locator(".tl-container").first().waitFor({ timeout: 20_000 });
    draw("three", chain(["x", "y", "z"]));
    const open = view("open-three");
    if (open.png.equals(edited.png)) fail("open canvas: picture did not change after the draw");
    ok(`open canvas: picture follows the draw (${open.width}x${open.height}; ${open.ms} ms)`);
  },
  () => {
    rmSync(join(SPACE, PATH), { force: true });
    rmSync(join(SPACE, "scratch-e2e-view.png"), { force: true });
    rmSync(specDir, { recursive: true, force: true });
  },
);
