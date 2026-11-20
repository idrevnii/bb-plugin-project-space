// The *Space folder* setting: with another folder name, `bb space root`
// names that folder, the Space page shows that folder's pages without a
// reload, and a folder that does not exist offers to create the space there.
// A path outside the checkout is refused. Restores the setting and deletes
// its scratch folder afterwards.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { OUT, PROJECT_ID, SPACE, bb, fail, ok, run, spaceUrl, waitFor } from "./lib.mjs";

const DIR = "scratch-e2e-folder/space";
const MISSING = "scratch-e2e-folder/none";

const values = () => JSON.parse(bb("plugin", "config", "project-space", "--json")).values;
const setDir = (value) =>
  value === "" || value === undefined
    ? bb("plugin", "config", "project-space", "unset", "spaceDir")
    : bb("plugin", "config", "project-space", "set", "spaceDir", value);
const root = () => bb("space", "root", "--project", PROJECT_ID).trim();

const before = values().spaceDir;
if (before) fail(`the Space folder setting is "${before}": run this script with the default folder`);
const checkout = dirname(SPACE);
const scratch = join(checkout, "scratch-e2e-folder");
const cleanup = () => {
  setDir(before);
  rmSync(scratch, { recursive: true, force: true });
};

rmSync(scratch, { recursive: true, force: true });
mkdirSync(join(checkout, DIR), { recursive: true });
writeFileSync(join(checkout, DIR, "index.md"), "# Other folder\n\nThis page is in the other space folder.\n");

await run(async ({ page }) => {
  await page.goto(spaceUrl("index.md"));
  await page.locator("article").first().waitFor({ timeout: 20_000 });

  // The setting takes `./x/` and the open page follows without a reload.
  setDir(`./${DIR}/`);
  if (root() !== join(checkout, DIR)) fail(`bb space root is ${root()}, not ${join(checkout, DIR)}`);
  ok("bb space root names the folder from the setting");
  await page.getByText("This page is in the other space folder.").waitFor({ timeout: 20_000 });
  await page.screenshot({ path: join(OUT, "space-folder.png") });
  ok("the open Space page shows the other folder without a reload");

  // A folder that does not exist: the empty state names it.
  setDir(MISSING);
  const empty = page.locator("p", { hasText: "has no space yet" });
  await empty.waitFor({ timeout: 20_000 });
  await page.locator("code", { hasText: `${MISSING}/` }).waitFor({ timeout: 5_000 });
  ok("a folder that does not exist offers a new space and names the folder");

  // Paths that leave the checkout are refused, and the setting stays.
  for (const bad of ["/etc", "../other"]) {
    let refused = false;
    try {
      setDir(bad);
    } catch {
      refused = true;
    }
    if (!refused) fail(`the setting took "${bad}"`);
  }
  if (values().spaceDir !== MISSING) fail("a refused value changed the setting");
  ok("absolute paths and .. are refused");

  // Back to the default: the page shows the usual space again.
  setDir(before);
  if (root() !== SPACE) fail(`bb space root is ${root()} after the reset, not ${SPACE}`);
  await waitFor("the default space to come back", async () => !(await empty.isVisible()));
  await page.locator("article").first().waitFor({ timeout: 20_000 });
  ok("the default folder comes back when the setting is empty");
}, cleanup);
