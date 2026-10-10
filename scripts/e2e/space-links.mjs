// The ways into the space from a thread: the Space button in the thread
// header (labelled, and icon-only on a narrow window) opens the project's
// space; it and the Space item in bb's sidebar come back to the last page
// that was open, and the project in the breadcrumbs opens the start page; a
// `::space` card in chat (what `bb space link` prints) shows the
// page's title and path, and *Open in space* opens that page.
//
//   THREAD_ID       thread whose header is used (default $BB_THREAD_ID, else
//                   the project's newest thread)
//   CARD_THREAD_ID  thread with a ::space card in a reply (default THREAD_ID);
//                   the card checks are skipped when it has none
import { BB_URL, PROJECT_ID, bb, fail, ok, panel, run, spaceUrl } from "./lib.mjs";

const threadUrl = (id) => `${BB_URL}/projects/${PROJECT_ID}/threads/${id}`;

function newestThread() {
  const threads = JSON.parse(bb("thread", "list", "--project", PROJECT_ID, "--json"));
  const list = Array.isArray(threads) ? threads : (threads.threads ?? threads.results ?? []);
  return list[0]?.id ?? null;
}

/** The last ::space directive an agent wrote in the thread, as attributes. */
function lastCard(threadId) {
  const log = bb("thread", "log", threadId, "--json", "--all");
  const directives = [...log.matchAll(/::space\{([^}\n]*)\}/g)]
    .map((match) => Object.fromEntries([...match[1].replaceAll('\\"', '"').matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]])))
    .filter((attributes) => attributes.project === PROJECT_ID && attributes.path && !attributes.path.includes("…"));
  return directives.at(-1) ?? null;
}

const THREAD = process.env.THREAD_ID ?? process.env.BB_THREAD_ID ?? newestThread();
if (!THREAD) fail("no thread in the project to open");
const CARD_THREAD = process.env.CARD_THREAD_ID ?? THREAD;
const LAST_PAGE = process.env.LAST_PAGE ?? "guides/developing.md";

await run(async ({ page }) => {
  const atSpace = (path = "") => (url) =>
    decodeURI(url.toString()).includes(`/plugins/project-space/space/${PROJECT_ID}${path === "" ? "" : `/${path}`}`);

  // 1. The header button, labelled on a wide window.
  await page.goto(threadUrl(THREAD));
  const button = page.getByRole("button", { name: "Open project space" });
  await button.waitFor({ timeout: 20_000 });
  if (!(await button.innerText()).includes("Space")) fail("the header button has no Space label on a wide window");
  await button.click();
  await page.waitForURL(atSpace(), { timeout: 10_000 });
  await panel(page).locator("h1").first().waitFor({ timeout: 20_000 });
  ok("the Space button in the thread header opens the project's space");

  // 2. Both ways in come back to the last page that was open.
  await page.goto(spaceUrl(LAST_PAGE));
  await page.waitForURL(atSpace(LAST_PAGE), { timeout: 10_000 });
  await panel(page).locator("h1").first().waitFor({ timeout: 20_000 });
  await page.goto(threadUrl(THREAD));
  await button.click();
  await page.waitForURL(atSpace(LAST_PAGE), { timeout: 10_000 });
  ok(`after ${LAST_PAGE}, the header button opens ${LAST_PAGE} again`);
  await page.goto(threadUrl(THREAD));
  await button.waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "Space", exact: true }).click();
  await page.waitForURL(atSpace(LAST_PAGE), { timeout: 10_000 });
  await panel(page).locator("h1").first().waitFor({ timeout: 20_000 });
  ok(`the Space item in the sidebar opens ${LAST_PAGE} again`);
  await panel(page).getByRole("navigation", { name: "Breadcrumbs" }).getByRole("button").first().click();
  await page.waitForURL(atSpace("index.md"), { timeout: 10_000 });
  ok("the project in the breadcrumbs opens the start page");

  // 3. Icon-only on a narrow window.
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto(threadUrl(THREAD));
  const compact = page.getByRole("button", { name: "Open project space" });
  await compact.waitFor({ timeout: 20_000 });
  if ((await compact.innerText()).trim() !== "") fail("the header button keeps its label on a narrow window");
  await compact.click();
  await page.waitForURL(atSpace(), { timeout: 10_000 });
  ok("on a narrow window it is an icon that still opens the space");
  await page.setViewportSize({ width: 1600, height: 1000 });

  // 4. A ::space card in chat.
  const card = lastCard(CARD_THREAD);
  if (card === null) {
    console.log(`skip ::space card: thread ${CARD_THREAD} has no card for ${PROJECT_ID} (set CARD_THREAD_ID)`);
    return;
  }
  await page.goto(threadUrl(CARD_THREAD));
  const open = page.getByRole("button", { name: "Open in space" }).last();
  const deadline = Date.now() + 30_000;
  // Long threads render lazily: scroll up until the card is in the DOM.
  while (!(await open.isVisible())) {
    if (Date.now() > deadline) fail(`no ::space card for ${card.path} rendered in ${CARD_THREAD}`);
    await page.mouse.move(900, 400);
    await page.mouse.wheel(0, -1500);
    await page.waitForTimeout(400);
  }
  const box = page.locator("div.rounded-lg.border", { has: open }).last();
  const text = await box.innerText();
  if (!text.includes(card.path)) fail(`the card does not show its path ${card.path}: ${text}`);
  if (card.title && !text.includes(card.title)) fail(`the card does not show its title ${card.title}`);
  ok(`a ::space card shows "${card.title ?? card.path}" and ${card.path}`);
  await open.click();
  await page.waitForURL(atSpace(card.path), { timeout: 10_000 });
  await panel(page).locator("h1, .tl-container, iframe").first().waitFor({ timeout: 20_000 });
  ok("Open in space opens the page");
});
