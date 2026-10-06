// Space search: `bb space search` finds a page by name and by text (a canvas
// by its labels); in the Files tab the box replaces the tree with results,
// Esc brings the tree back, Enter opens the first result, and clicking a
// text hit in a Markdown page scrolls to the section it is in. Uses only
// scratch-e2e-search* files and deletes them afterwards.
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, PROJECT_ID, SPACE, bb, fail, ok, panel, run, spaceUrl, waitFor } from "./lib.mjs";

const PAGE = "scratch-e2e-search.md";
const WORD = "zanzibarquokka";
const filler = (n) => Array.from({ length: n }, (_, i) => `Filler paragraph ${i}.\n`).join("\n");
const cleanup = () => rmSync(join(SPACE, PAGE), { force: true });

cleanup();
writeFileSync(
  join(SPACE, PAGE),
  `# Search scratch\n\n${filler(60)}\n## Target section\n\nThe ${WORD} lives here.\n\n${filler(60)}`,
);

const search = (query) => JSON.parse(bb("space", "search", query, "--json", "--project", PROJECT_ID));

// 1. The CLI finds names, text, and canvas labels.
const byName = search("scratch-e2e-search");
if (byName.results[0]?.kind !== "name" || byName.results[0]?.path !== PAGE) {
  fail(`"scratch-e2e-search" should find ${PAGE} by name first, got ${JSON.stringify(byName.results.slice(0, 3))}`);
}
ok(`bb space search finds ${PAGE} by name`);
const byText = search(WORD).results.find((hit) => hit.kind === "content" && hit.path === PAGE);
if (byText?.line !== 125 || !byText.snippet?.includes(WORD)) {
  fail(`"${WORD}" should hit ${PAGE}:125, got ${JSON.stringify(byText)}`);
}
ok(`bb space search finds "${WORD}" at ${PAGE}:${byText.line}`);
// Every canvas whose raw JSON has a label mentioning tldraw must be found.
const labelled = readdirSync(SPACE, { recursive: true })
  .map(String)
  .filter((path) => path.endsWith(".tldr") && /"text":"[^"]*tldraw/i.test(readFileSync(join(SPACE, path), "utf8")));
const canvasHits = search("tldraw").results.filter((hit) => hit.kind === "content" && hit.path.endsWith(".tldr"));
for (const path of labelled) {
  const hit = canvasHits.find((candidate) => candidate.path === path);
  if (hit === undefined) fail(`"tldraw" did not find the label in ${path}`);
  ok(`bb space search finds ${path} by label: "${hit.snippet}"`);
}

await run(async ({ page }) => {
  await page.goto(spaceUrl("index.md"));
  const root = panel(page);
  await root.locator("article").first().waitFor({ timeout: 20_000 });
  const box = page.getByRole("searchbox", { name: "Search the space" });
  const tree = page.locator('nav[aria-label="Space files"]');
  const results = page.getByRole("listbox", { name: "Search results" });
  const option = (kind, path) => results.locator(`[data-search-kind="${kind}"][data-search-path="${path}"]`);
  await box.waitFor({ timeout: 15_000 });

  // 2. Typing replaces the tree with results; Esc brings it back.
  await box.fill(WORD);
  await option("content", PAGE).waitFor({ timeout: 10_000 });
  if (await tree.isVisible()) fail("the tree stays visible while searching");
  await page.screenshot({ path: join(OUT, "search-results.png") });
  ok("typing shows results in place of the tree");
  await box.press("Escape");
  await waitFor("the tree back after Esc", async () => (await box.inputValue()) === "" && (await tree.isVisible()));
  ok("Esc clears the box and shows the tree");

  // 3. Enter opens the first result (the name match).
  await box.fill("scratch-e2e-search");
  await option("name", PAGE).waitFor({ timeout: 10_000 });
  await box.press("Enter");
  await waitFor(`${PAGE} opened`, async () => decodeURI(page.url()).endsWith(`/${PAGE}`));
  ok("Enter opens the first result");

  // 4. A text hit scrolls the page to its section.
  await page.goto(spaceUrl("index.md"));
  await box.fill(WORD);
  await option("content", PAGE).click();
  await waitFor(`${PAGE} opened from a text hit`, async () => decodeURI(page.url()).endsWith(`/${PAGE}`));
  const heading = root.locator("article h2", { hasText: "Target section" });
  await heading.waitFor({ timeout: 15_000 });
  const offset = () =>
    heading.evaluate((element) => {
      const scroller = element.closest(".overflow-y-auto");
      return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    });
  await waitFor('the page scrolled to "Target section"', async () => Math.abs(await offset()) < 80);
  await page.screenshot({ path: join(OUT, "search-scrolled.png") });
  ok("clicking a text hit scrolls to its section");
}, cleanup);
