// A page added in a worktree's own .bb-space shows up in the Space page's
// "worktrees changed the space" badge; it opens read-only from the worktree
// under a banner, both from the popover and from a `?env=` link, and is gone
// from the badge once deleted. Uses the first live worktree of the project
// (skips when there is none) and only writes scratch-e2e* files there.
import { existsSync, rmSync, writeFileSync } from "node:fs";
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

await run(
  async ({ page }) => {
    writeFileSync(scratch, "# Worktree scratch\n\nWritten only in the worktree.\n");
    await page.goto(spaceUrl("index.md"));
    const root = panel(page);
    const badge = root.getByRole("button", { name: /changed the space/ });
    await badge.waitFor({ timeout: 20_000 });
    ok(`badge: "${(await badge.innerText()).trim()}"`);

    await badge.click();
    const popover = root.getByRole("dialog", { name: "Worktree changes" });
    const entry = popover.getByRole("button", { name: PATH });
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
      const listed = await popover.getByRole("button", { name: PATH }).count();
      await page.keyboard.press("Escape");
      await root.locator(".fixed.inset-0").first().click({ force: true }).catch(() => {});
      return listed === 0;
    });
    ok("the deleted page is no longer listed");
  },
  () => rmSync(scratch, { force: true }),
);
