// Shared setup for the e2e scripts. They drive the installed plugin in a real
// bb server, so build and reload it from the main checkout first.
//
//   BB_URL       bb server origin (default http://127.0.0.1:38886)
//   PROJECT_ID   project whose space is opened (default $BB_PROJECT_ID)
//   CHROME_PATH  browser executable (default: playwright's chromium)
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const BB_URL = (process.env.BB_URL ?? "http://127.0.0.1:38886").replace(/\/$/, "");
export const PROJECT_ID = process.env.PROJECT_ID ?? process.env.BB_PROJECT_ID ?? "";
if (!PROJECT_ID) fail("set PROJECT_ID (or run inside a bb thread, which sets BB_PROJECT_ID)");

export const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(OUT, { recursive: true });

/** Runs the bb CLI and returns stdout. */
export function bb(...args) {
  return execFileSync(process.env.BB_CLI ?? "bb", args, { encoding: "utf8" });
}

/** Absolute path of the project's .bb-space directory. */
export const SPACE = bb("space", "root", "--project", PROJECT_ID).trim();

export function spaceUrl(path = "") {
  return `${BB_URL}/plugins/project-space/space/${PROJECT_ID}/${path}`;
}

export function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

export function ok(message) {
  console.log(`ok   ${message}`);
}

/** Launches a browser page that records uncaught page errors. */
export async function openBrowser() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: "dark" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message.slice(0, 300)));
  return { browser, page, errors };
}

/** Waits until `check` returns truthy, polling; fails with `what` on timeout. */
export async function waitFor(what, check, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`timed out waiting for ${what}`);
}

/** Runs `body`, closes the browser, and runs `cleanup` whatever happens. */
export async function run(body, cleanup = () => {}) {
  const session = await openBrowser();
  let code = 0;
  try {
    await body(session);
    if (session.errors.length > 0) {
      console.error(`FAIL page errors:\n  ${session.errors.join("\n  ")}`);
      code = 1;
    }
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.stack : error}`);
    code = 1;
  } finally {
    await session.browser.close();
    await cleanup();
  }
  process.exit(code);
}

/** The Space page's own panel; excludes the off-screen canvas renderer. */
export function panel(page) {
  return page.getByTestId("plugin-panel-body");
}
