// Loads bb's home page and each kind of space page fresh, and fails on any
// bb warning that blames this plugin for moving nodes out of React's tree.
// The warning comes from bb's DOM guard while a plugin content script is
// mounting (ui/headless.tsx); it used to appear on every page.
import { BB_URL, fail, ok, run, spaceUrl } from "./lib.mjs";

// bb home last: with a warm cache the shell renders while the renderer's
// mount is still waiting on its RPC, which is when the warning fired.
const PAGES = [
  ["index.md", spaceUrl("index.md")],
  ["a canvas", spaceUrl("architecture/diagram.tldr")],
  ["an HTML report", spaceUrl("reports/status.html")],
  ["bb home", `${BB_URL}/`],
  ["index.md again", spaceUrl("index.md")],
];

await run(async ({ page }) => {
  const warnings = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/project-space|plugin content script/.test(text) && /React's tree|no longer a child/.test(text)) {
      warnings.push(text.slice(0, 200));
    }
  });
  for (const [name, url] of PAGES) {
    warnings.length = 0;
    await page.goto(url);
    // The headless renderer mounts after its config RPC; give it time.
    await page.waitForTimeout(5_000);
    if (warnings.length > 0) fail(`${name}: ${warnings.join("\n  ")}`);
    ok(`${name} loads without a DOM-guard warning`);
  }
});
