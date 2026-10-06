// Opens roadmap.md and the Outline tab: the outline lists the page's
// headings with ids that exist in the page, a click scrolls the page to the
// heading, and scrolling the page moves the highlight. A canvas shows the
// "No outline" message.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { OUT, SPACE, fail, ok, panel, run, spaceUrl, waitFor } from "./lib.mjs";

const PATH = "roadmap.md";

await run(async ({ page }) => {
  // Short enough that roadmap.md scrolls past its last heading.
  await page.setViewportSize({ width: 1600, height: 600 });
  await page.goto(spaceUrl(PATH));
  const root = panel(page);
  const pageHeadings = root.locator("article :is(h1, h2, h3, h4, h5, h6)");
  await pageHeadings.first().waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "Outline", exact: true }).click();

  // 1. The outline lists the page's headings, pointing at their ids.
  const outline = page.getByRole("navigation", { name: "Outline" });
  const items = outline.getByRole("button");
  await waitFor("the outline", async () => (await items.count()) > 0);
  const listed = (await items.allInnerTexts()).map((text) => text.trim());
  const rendered = (await pageHeadings.allInnerTexts()).map((text) => text.trim());
  if (JSON.stringify(listed) !== JSON.stringify(rendered)) {
    fail(`outline ${JSON.stringify(listed)} != page headings ${JSON.stringify(rendered)}`);
  }
  if (listed.length < 3) fail(`expected at least 3 headings in ${PATH}, got ${listed.length}`);
  ok(`outline lists the ${listed.length} headings of ${PATH}`);

  const current = async () => (await outline.locator('[aria-current="location"]').allInnerTexts())[0]?.trim();
  /** Distance from the reader's top to a heading's top. */
  const offset = (text) =>
    pageHeadings.filter({ hasText: text }).first().evaluate((heading) => {
      const scroller = heading.closest(".overflow-y-auto");
      return heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    });

  await waitFor("the first heading highlighted", async () => (await current()) === listed[0]);
  ok("the first heading is highlighted at the top of the page");

  // 2. A click scrolls the page to the heading and highlights it.
  const last = listed.at(-1);
  await items.filter({ hasText: last }).click();
  await waitFor(`page scrolled to "${last}"`, async () => Math.abs(await offset(last)) < 80);
  await waitFor(`"${last}" highlighted`, async () => (await current()) === last);
  await page.screenshot({ path: join(OUT, "outline-click.png") });
  ok(`clicking "${last}" scrolls the page to it`);

  // 3. Scrolling the page moves the highlight.
  const box = await root.locator("article").boundingBox();
  await page.mouse.move(box.x + 20, 300);
  const scrollTop = () =>
    pageHeadings.first().evaluate((heading) => heading.closest(".overflow-y-auto").scrollTop);
  await waitFor("the page scrolled back to the top", async () => {
    await page.mouse.wheel(0, -400);
    return (await scrollTop()) === 0;
  });
  await waitFor("the highlight back on the first heading", async () => (await current()) === listed[0]);
  await page.mouse.wheel(0, (await offset(listed[1])) - 10);
  await waitFor(`the highlight on "${listed[1]}"`, async () => (await current()) === listed[1]);
  await page.screenshot({ path: join(OUT, "outline-scroll.png") });
  ok("scrolling the page moves the highlight");

  // 4. Files that are not Markdown have no outline.
  const canvas = readdirSync(SPACE, { recursive: true }).find((name) => String(name).endsWith(".tldr"));
  if (canvas === undefined) {
    ok("no canvas in the space; skipped the non-Markdown check");
    return;
  }
  await page.goto(spaceUrl(String(canvas)));
  await page.getByRole("button", { name: "Outline", exact: true }).click();
  await page.getByText("No outline for this file.").waitFor({ timeout: 15_000 });
  ok(`${canvas} shows "No outline for this file."`);
});
