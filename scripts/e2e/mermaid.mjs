// Writes a scratch page with a flowchart, a sequence diagram and a broken
// diagram; expects two rendered diagrams and one error (with the source shown)
// in both light and dark, and that a theme flip re-renders the diagrams.
// Deletes the page afterwards.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, SPACE, fail, ok, panel, run, spaceUrl, waitFor } from "./lib.mjs";

const PATH = "scratch-e2e-mermaid.md";
const file = join(SPACE, PATH);

writeFileSync(
  file,
  `# Mermaid e2e

\`\`\`mermaid
flowchart LR
  A[E2E start] --> B{Choice}
  B -->|yes| C[E2E done]
  B -->|no| A
\`\`\`

\`\`\`mermaid
sequenceDiagram
  Agent->>Space: write page
  Space-->>Agent: E2E rendered
\`\`\`

\`\`\`mermaid
flowchart LR
  A --> B -->
  this is not mermaid ((
\`\`\`
`,
);

async function setTheme(page, theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
}

async function check(page, theme) {
  const root = panel(page);
  const rendered = root.locator('[data-mermaid="ready"] svg');
  await waitFor(`two ${theme} diagrams`, async () => (await rendered.count()) === 2, 30_000);
  const errors = root.locator('[data-mermaid="error"]');
  if ((await errors.count()) !== 1) fail(`expected 1 mermaid error in ${theme}, got ${await errors.count()}`);
  const errorText = await errors.first().innerText();
  if (!errorText.includes("mermaid:")) fail(`error block lacks the error line:\n${errorText}`);
  // The source viewer renders inside a shadow root, which getByText pierces.
  await waitFor(
    "the diagram source in the error block",
    async () => (await errors.first().getByText("this is not mermaid").count()) > 0,
  );
  for (const label of ["E2E start", "E2E rendered"]) {
    if ((await root.getByText(label).count()) === 0) fail(`diagram label "${label}" missing in ${theme}`);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `mermaid-${theme}.png`), fullPage: true });
  ok(`${theme}: two diagrams and one error render`);
  return rendered.first().evaluate((svg) => svg.outerHTML.replace(/mermaid-[\w-]+/g, ""));
}

await run(
  async ({ page }) => {
    await page.goto(spaceUrl(PATH));
    await panel(page).getByText("Mermaid e2e").waitFor({ timeout: 20_000 });
    await setTheme(page, "dark");
    const dark = await check(page, "dark");
    await setTheme(page, "light");
    await waitFor(
      "diagram to re-render for the light theme",
      async () =>
        (await panel(page)
          .locator('[data-mermaid="ready"] svg')
          .first()
          .evaluate((svg) => svg.outerHTML.replace(/mermaid-[\w-]+/g, ""))
          .catch(() => dark)) !== dark,
    );
    await check(page, "light");
    ok("theme flip re-renders diagrams");
  },
  () => rmSync(file, { force: true }),
);
