// A page added in a worktree's own .bb-space shows up in the Space page's
// "worktrees changed the space" badge; it opens read-only from the worktree
// under a banner, both from the popover and from a `?env=` link, and is gone
// from the badge once deleted. Then the copy: **Copy to main space** in the
// banner copies a page; a page that main changed too needs a second click in
// the badge. Uses the first live worktree of the project (skips when there is
// none) and only writes scratch-e2e* files, in the worktree and in main.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { OUT, PROJECT_ID, SPACE, bb, fail, ok, panel, run, spaceUrl, waitFor } from "./lib.mjs";

const PATH = "scratch-e2e-worktree.md";
const main = dirname(SPACE);
const worktree = JSON.parse(bb("environment", "list", "--project", PROJECT_ID, "--status", "ready", "--json")).find(
  (env) =>
    env.path !== null &&
    env.path.replace(/\/+$/, "") !== main &&
    env.lifecycle?.phase === "active" &&
    existsSync(join(env.path, ".bb-space")),
);
if (worktree === undefined) {
  ok("skipped: the project has no live worktree with a space");
  process.exit(0);
}
const scratch = join(worktree.path, ".bb-space", PATH);
const BOTH = "scratch-e2e-worktree-both.md";
const scratchBoth = join(worktree.path, ".bb-space", BOTH);
const mainCopy = join(SPACE, PATH);
const mainBoth = join(SPACE, BOTH);
const cleanupAll = () => {
  for (const file of [scratch, scratchBoth, mainCopy, mainBoth]) rmSync(file, { force: true });
};

await run(
  async ({ page }) => {
    cleanupAll();
    writeFileSync(scratch, "# Worktree scratch\n\nWritten only in the worktree.\n");
    await page.goto(spaceUrl("index.md"));
    const root = panel(page);
    const badge = root.getByRole("button", { name: /changed the space/ });
    await badge.waitFor({ timeout: 20_000 });
    ok(`badge: "${(await badge.innerText()).trim()}"`);

    await badge.click();
    const popover = root.getByRole("dialog", { name: "Worktree changes" });
    const entry = popover.getByRole("button", { name: PATH, exact: true });
    await entry.waitFor({ timeout: 5000 });
    if (worktree.branchName && !(await popover.innerText()).includes(worktree.branchName)) {
      fail(`popover does not name branch ${worktree.branchName}`);
    }
    await page.screenshot({ path: join(OUT, "worktrees-popover.png") });
    ok(`popover lists ${PATH} on ${worktree.branchName}`);

    await entry.click();
    await root.getByText("not the main space").waitFor({ timeout: 10_000 });
    await root.getByRole("heading", { name: "Worktree scratch" }).waitFor({ timeout: 10_000 });
    if ((await root.getByRole("button", { name: "Edit" }).count()) > 0) fail("worktree view offers Edit");
    await page.screenshot({ path: join(OUT, "worktrees-view.png") });
    ok("the worktree's copy opens read-only under the banner");

    await root.getByRole("button", { name: "Open main version" }).click();
    await root.getByText("does not exist").waitFor({ timeout: 10_000 });
    ok("Open main version shows the main space (where the page does not exist)");

    await page.goto(`${spaceUrl(PATH)}?env=${encodeURIComponent(worktree.id)}`);
    await root.getByRole("heading", { name: "Worktree scratch" }).waitFor({ timeout: 20_000 });
    ok("a ?env= link opens the worktree's copy");

    rmSync(scratch);
    await page.goto(spaceUrl("index.md"));
    await root.locator("article h1").first().waitFor({ timeout: 20_000 });
    await waitFor("the badge to settle", async () => {
      if ((await badge.count()) === 0) return true;
      await badge.click();
      const listed = await popover.getByRole("button", { name: PATH, exact: true }).count();
      await page.keyboard.press("Escape");
      await root.locator(".fixed.inset-0").first().click({ force: true }).catch(() => {});
      return listed === 0;
    });
    ok("the deleted page is no longer listed");

    // Copy from the banner: main does not have the page, so one click copies.
    writeFileSync(scratch, "# Worktree scratch\n\nCopied from the banner.\n");
    await page.goto(`${spaceUrl(PATH)}?env=${encodeURIComponent(worktree.id)}`);
    await root.getByText("not the main space").waitFor({ timeout: 20_000 });
    const bannerCopy = root.getByRole("button", { name: `Copy to main space ${PATH}` });
    await bannerCopy.waitFor({ timeout: 70_000 });
    await bannerCopy.click();
    await waitFor("the page in the main space", () => existsSync(mainCopy) && readFileSync(mainCopy, "utf8") === readFileSync(scratch, "utf8"));
    await waitFor("the main version to open", async () => (await root.getByText("not the main space").count()) === 0);
    await root.getByRole("heading", { name: "Worktree scratch" }).waitFor({ timeout: 10_000 });
    ok("Copy to main space copies the page and opens the main version");

    // Main changed the page too: the badge warns, and the copy asks first.
    writeFileSync(mainBoth, "# Main version\n");
    writeFileSync(scratchBoth, "# Worktree version\n");
    await page.goto(spaceUrl("index.md"));
    await root.locator("article h1").first().waitFor({ timeout: 20_000 });
    await waitFor(
      "the badge to list the page that both changed",
      async () => {
        if ((await badge.count()) === 0) return false;
        if ((await popover.count()) === 0) await badge.click();
        const listed = (await popover.getByRole("button", { name: BOTH, exact: true }).count()) > 0;
        if (!listed) {
          await page.keyboard.press("Escape");
          await root.locator(".fixed.inset-0").first().click({ force: true }).catch(() => {});
        }
        return listed;
      },
      70_000,
    );
    // The page is the only listed file, so the note belongs to it.
    await popover.getByText("main changed it too").waitFor({ timeout: 5000 });
    await popover.getByRole("button", { name: `Copy ${BOTH}` }).click();
    const confirm = popover.getByRole("button", { name: `Replace main version of ${BOTH}?` });
    await confirm.waitFor({ timeout: 5000 });
    if (readFileSync(mainBoth, "utf8") !== "# Main version\n") fail("the first click replaced the main version");
    await page.screenshot({ path: join(OUT, "worktrees-copy-confirm.png") });
    await confirm.click();
    await waitFor("main to hold the worktree version", () => readFileSync(mainBoth, "utf8") === "# Worktree version\n");
    ok("a page that main changed too is marked, and copies only after the second click");
  },
  cleanupAll,
);
