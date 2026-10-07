import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchTree, type TreeWatcher } from "../server/watch-tree";

let dir = "";
let watcher: TreeWatcher | null = null;

afterEach(() => {
  watcher?.close();
  watcher = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A watcher over a fresh temp tree, and a check that the next step fires it. */
function setup() {
  dir = mkdtempSync(join(tmpdir(), "watch-tree-"));
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "a.tldr"), "a");
  let changes = 0;
  watcher = watchTree(dir, () => changes++, () => {});
  const fires = async (step: () => void) => {
    // Let pending events and scans settle first.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const before = changes;
    step();
    await vi.waitFor(() => expect(changes).toBeGreaterThan(before), { timeout: 2000 });
  };
  return { fires };
}

describe("watchTree", () => {
  it("keeps seeing a file after it is replaced by rename", async () => {
    const { fires } = setup();
    const file = join(dir, "sub", "a.tldr");
    await fires(() => writeFileSync(file, "b"));
    await fires(() => {
      writeFileSync(join(dir, "sub", ".a.tmp"), "c");
      renameSync(join(dir, "sub", ".a.tmp"), file);
    });
    await fires(() => writeFileSync(file, "d"));
    await fires(() => writeFileSync(file, "e"));
  });

  it("watches folders created after it started", async () => {
    const { fires } = setup();
    await fires(() => mkdirSync(join(dir, "new", "deeper"), { recursive: true }));
    await fires(() => writeFileSync(join(dir, "new", "deeper", "page.md"), "# hi"));
  });

  it("throws for a root that does not exist", () => {
    expect(() => watchTree(join(tmpdir(), "no-such-space-dir"), () => {}, () => {})).toThrow();
  });
});
