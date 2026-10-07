// The agent's side of the loop: a comment created over RPC shows in
// `bb space annotations list`; `show` prints the quote with its lines of
// context; `reply` and then `resolve` from the CLI show in the open Review
// tab without a reload. Cleans up its scratch page and annotations.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, PROJECT_ID, SPACE, bb, fail, ok, panel, run, spaceUrl, waitFor } from "./lib.mjs";

const PATH = "scratch-e2e-agent.md";
const file = join(SPACE, PATH);
const annotationFile = join(SPACE, ".space", "annotations", `${PATH}.json`);
const inputFile = join(OUT, "agent-input.json");
const space = (...args) => bb("space", "annotations", ...args, "--project", PROJECT_ID);

writeFileSync(file, `# Agent e2e\n\nOne.\n\nTwo.\n\nThe agent fixes the plums here.\n\nThree.\n\nFour.\n`);
writeFileSync(
  inputFile,
  JSON.stringify({
    projectId: PROJECT_ID,
    path: PATH,
    anchor: { kind: "text-quote", exact: "fixes the plums", prefix: "The agent ", suffix: " here." },
    comment: "Which plums?",
  }),
);
const { annotation } = JSON.parse(
  bb("plugin", "rpc", "call", "project-space", "annotations_create", "--input-file", inputFile, "--json"),
);
const id = annotation.id;

await run(
  async ({ page }) => {
    const listed = space("list", "--path", PATH);
    if (!listed.includes(id) || !listed.includes("«fixes the plums» → Which plums?")) fail(`list:\n${listed}`);
    ok("list shows the comment created over RPC");

    const shown = space("show", id);
    for (const want of ["Now at line 7:", "> 7 | The agent fixes the plums here.", "  4 | ", " 10 | "]) {
      if (!shown.includes(want)) fail(`show lacks "${want}":\n${shown}`);
    }
    ok("show prints the quote with three lines either side");

    const body = panel(page);
    await page.goto(spaceUrl("index.md"));
    await body.locator("article").waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "Review", exact: true }).click();
    const item = page.getByRole("navigation", { name: "Review" }).locator(`li[data-annotation-id="${id}"]`);
    await item.waitFor({ timeout: 15_000 });

    space("reply", id, "Victoria plums?");
    await item.getByText("Victoria plums?").waitFor({ timeout: 15_000 });
    if ((await item.getAttribute("data-status")) !== "open") fail("reply changed the status");
    ok("a reply shows in the tab live, the comment still open");

    space("resolve", id, "--note", "Named them: Victoria");
    await waitFor("resolved in the tab, live", async () => (await item.getAttribute("data-status")) === "resolved");
    await item.getByText("Named them: Victoria").waitFor({ timeout: 5_000 });
    await page.screenshot({ path: join(OUT, "annotations-agent-resolved.png") });
    if (!space("list", "--status", "resolved", "--path", PATH).includes(id)) fail("not listed as resolved");
    ok("resolve flips it; the tab shows it resolved with the note, without a reload");
  },
  () => {
    rmSync(file, { force: true });
    rmSync(annotationFile, { force: true });
    rmSync(inputFile, { force: true });
  },
);
