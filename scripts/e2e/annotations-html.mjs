// Annotating an HTML page (reports/status.html) in *Annotate* mode: the
// page's own script still runs; messages the page forges (a fake selection
// posted to bb, a script selection with a dispatched mouseup) offer no
// *Comment*; a real triple-click on the heading does. The comment's highlight
// is painted inside the frame and is there after a reload; clicking it opens
// the comment, and so does the Review tab, switching *Annotate* on. Turning
// *Annotate* off goes back to the plain preview URL.
// Deletes only the annotations it created.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, PROJECT_ID, SPACE, bb, fail, ok, panel, run, spaceUrl, waitFor } from "./lib.mjs";

const PATH = "reports/status.html";
const HEADING = "Project Space — status";
const annotationFile = join(SPACE, ".space", "annotations", `${PATH}.json`);
const hadAnnotations = existsSync(annotationFile);
const inputFile = join(OUT, "annotations-html-input.json");
const created = new Set();

function rpc(method, input) {
  writeFileSync(inputFile, JSON.stringify({ projectId: PROJECT_ID, ...input }));
  return JSON.parse(bb("plugin", "rpc", "call", "project-space", method, "--input-file", inputFile, "--json"));
}

/** Annotations on the page this run made, found by their comment. */
const mine = () => rpc("annotations_list", { path: PATH }).annotations.filter((each) => each.comment.startsWith("e2e:"));

/** Turns *Annotate* on and returns the frame running the bridge. */
async function annotate(page) {
  const body = panel(page);
  const toggle = body.getByRole("button", { name: "Annotate" });
  await toggle.waitFor({ timeout: 20_000 });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  const element = body.locator('iframe[title$="(annotate)"]');
  await element.waitFor({ timeout: 10_000 });
  const frame = await (await element.elementHandle()).contentFrame();
  await frame.locator("h1").waitFor({ timeout: 10_000 });
  return frame;
}

const highlighted = (frame, name = "space-annotation") =>
  frame.evaluate((highlight) => [...(CSS.highlights.get(highlight) ?? [])].map((range) => range.toString()), name);

await run(
  async ({ page }) => {
    const body = panel(page);
    const comment = body.getByRole("button", { name: "Comment", exact: true });
    await page.goto(spaceUrl(PATH));
    let frame = await annotate(page);

    await waitFor("the page's script to fill the progress bar", () =>
      frame.evaluate(() => document.getElementById("progress")?.style.width.endsWith("%")),
    );
    if (await frame.evaluate(() => [...document.scripts].some((script) => script.textContent.includes("project-space-annotate")))) {
      fail("the bridge's <script> is still in the page for its scripts to read");
    }
    ok("the page's own script runs in annotate mode; the bridge script is gone from the DOM");

    // A hostile page: it cannot know the token, and its events are not trusted.
    await frame.evaluate(() => {
      const rect = { top: 10, left: 10, bottom: 20, right: 20 };
      for (const token of ["", "guess"]) {
        parent.postMessage(
          { channel: "project-space-annotate", token, message: { type: "selection", exact: "forged", prefix: "", suffix: "", rect } },
          "*",
        );
      }
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("h1"));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForTimeout(800);
    if (await comment.isVisible()) fail("a forged selection offered Comment");
    await frame.evaluate(() => getSelection().removeAllRanges());
    ok("forged messages and script selections offer no Comment");

    await frame.locator("h1").click({ clickCount: 3 });
    await comment.waitFor({ timeout: 5_000 });
    await page.screenshot({ path: join(OUT, "annotations-html-select.png") });
    await comment.click();
    const dialog = body.getByRole("dialog", { name: "New comment" });
    await dialog.getByRole("textbox", { name: "Comment" }).fill("e2e: say which version");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
    await dialog.waitFor({ state: "detached", timeout: 5_000 });
    await waitFor("the annotation to be stored", () => mine().length === 1);
    const [stored] = mine();
    created.add(stored.id);
    if (stored.anchor.exact !== HEADING) fail(`anchor is not the heading: ${JSON.stringify(stored.anchor)}`);
    await waitFor("the heading to be highlighted", async () => (await highlighted(frame)).join() === HEADING);
    ok("a selected heading gets a comment and a highlight inside the frame");

    await page.reload();
    frame = await annotate(page);
    await waitFor("the highlight after a reload", async () => (await highlighted(frame)).join() === HEADING);
    await page.screenshot({ path: join(OUT, "annotations-html-reload.png") });
    ok("the highlight is there after a reload");

    await frame.locator("h1").click();
    const card = body.getByRole("dialog", { name: "Comment" });
    await card.getByText("e2e: say which version").waitFor({ timeout: 5_000 });
    if ((await highlighted(frame, "space-annotation-active")).join() !== HEADING) fail("open comment is not marked active");
    await card.getByRole("button", { name: "Resolve" }).click();
    await waitFor("the resolve to be stored", () => mine()[0]?.status === "resolved");
    await page.screenshot({ path: join(OUT, "annotations-html-card.png") });
    await page.keyboard.press("Escape");
    await card.waitFor({ state: "detached", timeout: 5_000 });
    await waitFor("the resolved highlight", async () => (await highlighted(frame, "space-annotation-resolved")).join() === HEADING);
    ok("clicking the highlight opens the comment; resolving is stored");

    await body.getByRole("button", { name: "Annotate" }).click();
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Review" })
      .getByRole("listitem")
      .filter({ hasText: "e2e: say which version" })
      .getByRole("button")
      .click();
    await card.getByText("e2e: say which version").waitFor({ timeout: 15_000 });
    if ((await body.getByRole("button", { name: "Annotate" }).getAttribute("aria-pressed")) !== "true") {
      fail("the Review tab did not switch Annotate on");
    }
    await page.keyboard.press("Escape");
    ok("the Review tab opens the comment, switching Annotate on");

    await body.getByRole("button", { name: "Annotate" }).click();
    const plain = body.locator(`iframe[title="status.html"]`);
    await plain.waitFor({ timeout: 5_000 });
    if ((await plain.getAttribute("srcdoc")) !== null || !(await plain.getAttribute("src"))?.includes(PATH)) {
      fail("the plain view is not the preview URL");
    }
    ok("turning Annotate off shows the plain preview URL");
  },
  () => {
    for (const id of created) {
      try {
        rpc("annotations_delete", { id });
      } catch {}
    }
    if (!hadAnnotations) rmSync(annotationFile, { force: true });
    rmSync(inputFile, { force: true });
  },
);
