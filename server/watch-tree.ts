// A recursive directory watcher that survives atomic saves.
//
// Node's `fs.watch(dir, { recursive: true })` on Linux watches every file on
// its own, so a file replaced by rename (how bb and editors save) drops out
// of the watch and its later changes go unseen. Here every directory gets a
// plain watch instead; a directory watch reports changes to the entries in
// it, whatever their inode. New directories are picked up as they appear.
import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface TreeWatcher {
  close(): void;
}

/**
 * Calls `onChange` for any change under `root`. `onError` fires once when the
 * root itself can no longer be watched; the watcher is closed by then.
 * Throws when `root` cannot be watched at all (it does not exist).
 */
export function watchTree(
  root: string,
  onChange: () => void,
  onError: (error: unknown) => void,
): TreeWatcher {
  const watchers = new Map<string, FSWatcher>();
  let closed = false;

  const close = () => {
    closed = true;
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };

  /** Stops watching `dir` and everything below it. */
  const drop = (dir: string) => {
    for (const [path, watcher] of watchers) {
      if (path === dir || path.startsWith(`${dir}/`)) {
        watcher.close();
        watchers.delete(path);
      }
    }
  };

  /** Watches one directory; throws when it cannot be watched. */
  const watchDir = (dir: string) => {
    if (closed || watchers.has(dir)) return;
    const watcher = watch(dir, (_event, name) => {
      onChange();
      // A new or removed entry: start or stop watching it if it is a folder.
      if (name !== null) void sync(join(dir, String(name)));
    });
    watcher.on("error", (error) => {
      if (dir !== root) return drop(dir);
      close();
      onError(error);
    });
    watchers.set(dir, watcher);
  };

  /** Watches the directories below `dir`. */
  const scan = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // removed meanwhile
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await sync(join(dir, entry.name));
    }
  };

  /** Brings `path` in line with the disk: watched if it is a folder. */
  const sync = async (path: string): Promise<void> => {
    if (closed) return;
    try {
      if (!(await stat(path)).isDirectory()) return drop(path);
      if (watchers.has(path)) return;
      watchDir(path);
    } catch {
      return drop(path); // gone
    }
    await scan(path);
  };

  watchDir(root);
  void scan(root);
  return { close };
}
