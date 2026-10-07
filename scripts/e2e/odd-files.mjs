// Files the space does not write itself: a Latin-1 page and random bytes get
// a "not UTF-8" notice (never their base64, never an Edit button) and stay
// byte-for-byte untouched; a NUL in a .txt shows as text; an image renders;
// a 5 MB page renders, scrolls to its end and opens in the editor; an empty
// folder and a folder of only images say there is nothing to read. Uses only
// scratch-e2e-odd/ and deletes it afterwards.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, SPACE, fail, ok, panel, run, showFiles, spaceUrl } from "./lib.mjs";

const DIR = "scratch-e2e-odd";
const at = (name) => join(SPACE, DIR, name);
const cleanup = () => rmSync(join(SPACE, DIR), { recursive: true, force: true });

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const LATIN1 = Buffer.from("# Caf\xe9\n\nna\xefve text\n", "latin1");
const BLOB = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 7919 + 13) % 256));

function bigPage() {
  const paragraph = `${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(10)}\n\n`;
  const parts = ["# Big page\n\n"];
  let size = 0;
  for (let i = 1; size < 5 * 1024 * 1024; i++) {
    const part = i % 50 === 0 ? `## Section ${i}\n\n${paragraph}` : paragraph;
    parts.push(part);
    size += part.length;
  }
  parts.push("The end marker.\n");
  return parts.join("");
}

cleanup();
mkdirSync(join(SPACE, DIR, "empty"), { recursive: true });
mkdirSync(join(SPACE, DIR, "images"), { recursive: true });
writeFileSync(at("latin1.md"), LATIN1);
writeFileSync(at("blob.bin"), BLOB);
writeFileSync(at("nul.txt"), "before\0after\n");
writeFileSync(at("pixel.png"), PNG);
writeFileSync(at("images/only.png"), PNG);
writeFileSync(at("big.md"), bigPage());

await run(async ({ page }) => {
  const body = panel(page);
  const edit = body.getByRole("button", { name: "Edit" });

  // 1. Not UTF-8: a notice, no base64, no Edit, the file untouched.
  for (const [name, bytes] of [["latin1.md", LATIN1], ["blob.bin", BLOB]]) {
    await page.goto(spaceUrl(`${DIR}/${name}`));
    await body.getByText(`${name} is not UTF-8 text`).waitFor({ timeout: 20_000 });
    const base64 = bytes.toString("base64").slice(0, 16);
    if ((await body.innerText()).includes(base64)) fail(`${name} shows its base64`);
    if (await edit.isVisible()) fail(`${name} offers Edit`);
    if (!readFileSync(at(name)).equals(bytes)) fail(`opening ${name} changed it`);
    ok(`${name}: a "not UTF-8" notice, no Edit, the file untouched`);
  }
  await page.screenshot({ path: join(OUT, "odd-files-latin1.png") });

  // 2. A NUL byte in a text file is still text.
  await page.goto(spaceUrl(`${DIR}/nul.txt`));
  await body.getByText("after").first().waitFor({ timeout: 20_000 });
  ok("a .txt with a NUL byte shows as text");

  // 3. An image renders from the preview URL.
  await page.goto(spaceUrl(`${DIR}/pixel.png`));
  const image = body.locator('img[alt="pixel.png"]');
  await image.waitFor({ timeout: 20_000 });
  const loaded = await image.evaluate((element) =>
    element.complete ? element.naturalWidth : new Promise((resolve) => (element.onload = () => resolve(element.naturalWidth))),
  );
  if (loaded !== 1) fail(`the image did not load (${loaded})`);
  ok("an image renders");

  // 4. A 5 MB page: renders, reaches its end, opens in the editor.
  const started = Date.now();
  await page.goto(spaceUrl(`${DIR}/big.md`));
  await body.getByText("The end marker.").waitFor({ timeout: 60_000 });
  const renderMs = Date.now() - started;
  await body.getByText("The end marker.").scrollIntoViewIfNeeded();
  ok(`a 5 MB page renders to its last line in ${renderMs} ms`);
  const editStarted = Date.now();
  await edit.click();
  await body.locator(".ProseMirror").getByText("The end marker.").waitFor({ timeout: 60_000 });
  ok(`and opens in the editor in ${Date.now() - editStarted} ms`);
  await body.getByRole("button", { name: "Done" }).click();
  await page.screenshot({ path: join(OUT, "odd-files-big.png") });

  // 5. Folders with nothing to read.
  for (const folder of ["empty", "images"]) {
    await page.goto(spaceUrl(`${DIR}/${folder}`));
    await body.getByText("This folder has no pages yet.").waitFor({ timeout: 20_000 });
  }
  const tree = await showFiles(page);
  await tree.locator(`[data-tree-path="${DIR}/empty"]`).waitFor({ timeout: 10_000 });
  ok("an empty folder and a folder of only images say there is nothing to read; the tree lists them");
}, cleanup);
