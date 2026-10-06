// Links from a space page to project files outside the space: a relative
// link that climbs out of .bb-space opens the file in bb's preview panel with
// its line (or line range) highlighted; a link that escapes the checkout is
// plain text with a title; a space-internal link still routes in the space.
// Uses only scratch-e2e-links/ and deletes it afterwards.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { OUT, SPACE, fail, ok, panel, run, spaceUrl, waitFor } from "./lib.mjs";

const DIR = "scratch-e2e-links";
const PAGE = `${DIR}/page.md`;
const CHECKOUT = dirname(SPACE);
const cleanup = () => rmSync(join(SPACE, DIR), { recursive: true, force: true });

cleanup();
mkdirSync(join(SPACE, DIR));
writeFileSync(
  join(SPACE, PAGE),
  [
    "# Links scratch",
    "",
    "- [server](../../server/index.ts#L10)",
    "- [resolver](../../lib/space.ts#L40-L44)",
    "- [escape](../../../etc/passwd)",
    "- [home](../index.md)",
    "",
  ].join("\n"),
);

/** Header path and selected line numbers of bb's file preview. */
const preview = (page) =>
  page.evaluate(() => {
    const all = [];
    const walk = (root) => {
      for (const element of root.querySelectorAll("*")) {
        all.push(element);
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    walk(document);
    return {
      paths: all
        .filter((element) => element.children.length === 0 && element.textContent?.trim().startsWith("‎/"))
        .map((element) => element.textContent.trim().slice(1)),
      selected: all
        .filter((element) => element.hasAttribute("data-selected-line") && element.hasAttribute("data-column-number"))
        .map((element) => Number(element.getAttribute("data-column-number"))),
    };
  });

await run(async ({ page }) => {
  await page.goto(spaceUrl(PAGE));
  const root = panel(page);
  const server = root.getByRole("link", { name: "server", exact: true });
  await server.waitFor({ timeout: 20_000 });

  // 1. A link out of the space opens the checkout file at its line.
  await server.click();
  const serverPath = `${CHECKOUT}/server/index.ts`;
  await waitFor("server/index.ts in the preview at line 10", async () => {
    const state = await preview(page);
    return state.paths.includes(serverPath) && state.selected.join() === "10";
  });
  await page.screenshot({ path: join(OUT, "outside-links-line.png") });
  ok("../../server/index.ts#L10 opens the file at line 10");

  // 2. A line range highlights every line in it.
  await root.getByRole("link", { name: "resolver", exact: true }).click();
  const resolverPath = `${CHECKOUT}/lib/space.ts`;
  await waitFor("lib/space.ts in the preview at lines 40-44", async () => {
    const state = await preview(page);
    return state.paths.includes(resolverPath) && state.selected.join() === "40,41,42,43,44";
  });
  await page.screenshot({ path: join(OUT, "outside-links-range.png") });
  ok("../../lib/space.ts#L40-L44 highlights lines 40-44");

  // 3. A link that escapes the checkout is not a link, and says why.
  if ((await root.getByRole("link", { name: "escape", exact: true }).count()) !== 0) {
    fail("a link escaping the checkout should not render as a link");
  }
  const title = await root.getByText("escape", { exact: true }).getAttribute("title");
  if (!title?.includes("outside the project checkout")) fail(`escape link title: ${JSON.stringify(title)}`);
  ok("a link escaping the checkout is plain text with a title");

  // 4. Space-internal links still route inside the space.
  await root.getByRole("link", { name: "home", exact: true }).click();
  await waitFor("index.md open", async () => page.url().endsWith("/index.md"));
  ok("../index.md still opens the space page");
}, cleanup);
