// The Review tab: two comments on a scratch page are listed under their file
// with "2 open"; clicking one opens the page at it with its comment shown;
// *Send to… → New thread* opens the new-thread composer prefilled with the
// review message (the draft is cleared again). With REVIEW_THREAD_ID set,
// *Send to…* that thread posts the message there and the tab shows both
// comments as sent without a reload; skipped otherwise, because it starts a
// turn in that thread. A third comment is deleted with its trash button. With
// *Delete resolved comments* on, a fourth one resolved through the RPC goes
// from the store and the tab. Cleans up its scratch page and annotations.
//
//   REVIEW_THREAD_ID  a thread of the project to post the review to (optional)
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, PROJECT_ID, SPACE, autoDeleteResolved, bb, fail, ok, panel, run, spaceUrl, waitFor } from "./lib.mjs";

const PATH = "scratch-e2e-review.md";
const file = join(SPACE, PATH);
const annotationFile = join(SPACE, ".space", "annotations", `${PATH}.json`);
const inputFile = join(OUT, "review-input.json");
const THREAD_ID = process.env.REVIEW_THREAD_ID ?? "";

function rpc(method, input) {
  writeFileSync(inputFile, JSON.stringify({ projectId: PROJECT_ID, ...input }));
  return JSON.parse(bb("plugin", "rpc", "call", "project-space", method, "--input-file", inputFile, "--json"));
}
const list = () => rpc("annotations_list", { path: PATH }).annotations;
const quote = (exact) => ({ kind: "text-quote", exact, prefix: "", suffix: "" });

/** Unticks every open comment but this script's two, so only they are sent. */
async function onlyOurs(review) {
  for (const checkbox of await review.locator('li[data-status="open"] input[type="checkbox"]').all()) {
    const id = await checkbox.evaluate((input) => input.closest("li").dataset.annotationId);
    if (id !== first.id && id !== second.id && (await checkbox.isChecked())) await checkbox.uncheck();
  }
}

writeFileSync(
  file,
  `# Review e2e\n\nThe first paragraph talks about apples.\n\n${"Filler line.\n\n".repeat(60)}The last paragraph talks about pears.\n`,
);
const first = rpc("annotations_create", { path: PATH, anchor: quote("talks about apples"), comment: "Say which apples" }).annotation;
const second = rpc("annotations_create", { path: PATH, anchor: quote("talks about pears"), comment: "Pears need a source" }).annotation;
const expected = [
  "Review of the project space — 2 comments.",
  `1. ${PATH} — «talks about apples» → Say which apples  [${first.id}]`,
  `2. ${PATH} — «talks about pears» → Pears need a source  [${second.id}]`,
  'Resolve each with `bb space annotations resolve <id> --note "…"` when done.',
].join("\n");

await run(
  async ({ page }) => {
    const body = panel(page);
    await page.goto(spaceUrl("index.md"));
    await body.locator("article").waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "Review", exact: true }).click();
    const review = page.getByRole("navigation", { name: "Review" });
    const items = review.locator(`[data-review-path="${PATH}"] li`);
    await waitFor("both comments in the tab", async () => (await items.count()) === 2);
    const count = await page.getByTestId("review-open-count").innerText();
    if (!/^\d+ open$/.test(count) || Number.parseInt(count, 10) < 2) fail(`open count reads "${count}"`);
    await page.screenshot({ path: join(OUT, "review-tab.png") });
    ok(`the tab lists both comments under ${PATH} (${count})`);

    await items.filter({ hasText: "Pears need a source" }).getByRole("button").first().click();
    const card = body.getByRole("dialog", { name: "Comment" });
    await card.getByText("Pears need a source").waitFor({ timeout: 15_000 });
    await waitFor("the page scrolled to the pears", () =>
      body.locator("article").evaluate((article) => {
        const scroller = article.closest(".overflow-y-auto");
        const last = [...article.querySelectorAll("p")].at(-1);
        const box = scroller.getBoundingClientRect();
        const top = last.getBoundingClientRect().top;
        return scroller.scrollTop > 0 && top >= box.top && top <= box.bottom;
      }),
    );
    if (!page.url().includes(PATH)) fail(`clicking the comment did not open ${PATH}: ${page.url()}`);
    await page.screenshot({ path: join(OUT, "review-jump.png") });
    ok("clicking a comment opens its page scrolled to it, comment shown");
    await page.keyboard.press("Escape");

    const third = rpc("annotations_create", { path: PATH, anchor: quote("Filler line"), comment: "Delete me" }).annotation;
    const doomed = review.locator(`li[data-annotation-id="${third.id}"]`);
    await doomed.waitFor({ timeout: 15_000 });
    await doomed.hover();
    await doomed.getByRole("button", { name: /^Delete comment/ }).click();
    await waitFor("the deleted comment to leave the tab", async () => (await doomed.count()) === 0);
    if (list().some((each) => each.id === third.id)) fail("the trash button did not delete the comment");
    ok("the trash button in the Review tab deletes a comment");

    if (!autoDeleteResolved()) {
      ok("skipped auto-delete of resolved comments (the setting is off)");
    } else {
      const fourth = rpc("annotations_create", { path: PATH, anchor: quote("Filler line"), comment: "Resolve me" }).annotation;
      const resolving = review.locator(`li[data-annotation-id="${fourth.id}"]`);
      await resolving.waitFor({ timeout: 15_000 });
      rpc("annotations_update", { id: fourth.id, status: "resolved" });
      await waitFor("the resolved comment to leave the tab", async () => (await resolving.count()) === 0);
      if (list().some((each) => each.id === fourth.id)) fail("the resolved comment is still stored");
      ok("a resolved comment is deleted when Delete resolved comments is on");
    }

    await onlyOurs(review);
    await page.getByRole("button", { name: "Send to…" }).click();
    const menu = page.getByRole("dialog", { name: "Send to" });
    await menu.getByText("Send 2 comments to…").waitFor({ timeout: 5_000 });
    await page.screenshot({ path: join(OUT, "review-send-menu.png") });
    await menu.getByRole("button", { name: "New thread", exact: true }).click();
    const composer = page.locator('[contenteditable="true"]').filter({ hasText: "Review of the project space" });
    await composer.first().waitFor({ timeout: 15_000 });
    const drafted = (await composer.first().innerText()).replace(/\u00a0/g, " ").trim();
    await page.screenshot({ path: join(OUT, "review-new-thread.png") });
    // Leave the user's new-thread draft as it was: empty.
    await composer.first().click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await waitFor("the draft to be cleared", async () => (await composer.count()) === 0);
    const normalize = (text) => text.split("\n").map((line) => line.trimEnd()).filter((line) => line !== "").join("\n");
    if (normalize(drafted) !== normalize(expected)) {
      fail(`composer text differs:\n--- got\n${drafted}\n--- want\n${expected}`);
    }
    if (list().some((each) => each.status !== "open")) fail("a prefilled draft marked comments sent");
    ok("Send to → New thread prefills the composer with the review message");

    if (THREAD_ID === "") {
      ok("skipped sending to an existing thread (set REVIEW_THREAD_ID)");
      return;
    }
    await page.goto(spaceUrl(PATH));
    await body.locator("article").waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await waitFor("both comments in the tab", async () => (await items.count()) === 2);
    await onlyOurs(review);
    await page.getByRole("button", { name: "Send to…" }).click();
    const threads = menu.getByRole("list", { name: "Threads" });
    await threads.waitFor({ timeout: 10_000 });
    // The picker lists the 30 most recent threads; a fresh thread is among them.
    await threads.locator(`button[data-thread-id="${THREAD_ID}"]`).click();
    await page.getByRole("status").getByText("Sent 2 comments").waitFor({ timeout: 15_000 });
    await waitFor("both shown as sent, live", async () => (await review.locator(`[data-review-path="${PATH}"] li[data-status="sent"]`).count()) === 2);
    const stored = list();
    if (!stored.every((each) => each.status === "sent" && each.sentTo?.threadId === THREAD_ID)) {
      fail(`not marked sent to ${THREAD_ID}: ${JSON.stringify(stored)}`);
    }
    await waitFor("the message in the thread", () => {
      const seen = bb("thread", "log", THREAD_ID, "--limit", "3") + bb("thread", "queue", "list", THREAD_ID, "--json");
      return seen.includes(first.id) && seen.includes(second.id);
    });
    await page.screenshot({ path: join(OUT, "review-sent.png") });
    ok("Send to → a thread posts the message there; the tab shows them sent without a reload");
  },
  () => {
    rmSync(file, { force: true });
    rmSync(annotationFile, { force: true });
    rmSync(inputFile, { force: true });
  },
);
