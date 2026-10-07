// "2 worktrees changed the space": threads in worktrees write their own copy
// of `.bb-space/`, which the Space page (the main checkout) does not show.
// The popover lists each worktree's branch, threads and changed files; a
// file opens read-only from that worktree. Nothing is merged or copied.
import { useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { SpaceWorktree } from "../../server";
import { useSpaceNavigation } from "./routing";

const CHANGE_LABEL = { added: "A", modified: "M", deleted: "D" } as const;
const CHANGE_TITLE = {
  added: "Added in this worktree",
  modified: "Differs from the main space",
  deleted: "Deleted in this worktree",
} as const;

export function WorktreeBadge({
  projectId,
  worktrees,
  activeEnv = null,
  activePath = null,
}: {
  projectId: string;
  worktrees: SpaceWorktree[];
  activeEnv?: string | null;
  activePath?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const go = useSpaceNavigation();
  const navigate = useBbNavigate();
  if (worktrees.length === 0) return null;
  const count = worktrees.length;
  const label = `${count} ${count === 1 ? "worktree" : "worktrees"} changed the space`;
  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="gap-1.5 text-xs text-amber-600 dark:text-amber-400"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="GitBranch" className="size-3.5" />
        {label}
      </Button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Worktree changes"
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
            className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-96 overflow-y-auto rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg"
          >
            <p className="mb-3 text-muted-foreground">
              Threads in these worktrees wrote their own copy of the space. The page
              shows the main checkout; open a file here to read the worktree's version.
            </p>
            <ul className="space-y-3">
              {worktrees.map((worktree) => (
                <li key={worktree.environmentId} className="rounded-md border border-border p-2">
                  <div className="flex items-center gap-1.5 font-mono text-[11px] text-foreground">
                    <Icon name="GitBranch" className="size-3 shrink-0" />
                    <span className="truncate">{worktree.branch ?? worktree.environmentId}</span>
                  </div>
                  {worktree.threads.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {worktree.threads.map((thread) => (
                        <li key={thread.id}>
                          <button
                            type="button"
                            className="truncate text-left text-muted-foreground hover:text-foreground hover:underline"
                            onClick={() => {
                              setOpen(false);
                              navigate.toThread(thread.id);
                            }}
                          >
                            {thread.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <ul className="mt-2 space-y-0.5">
                    {worktree.files.map((file) => {
                      const active = activeEnv === worktree.environmentId && activePath === file.path;
                      return (
                        <li key={file.path} className="flex items-center gap-2" title={CHANGE_TITLE[file.change]}>
                          <span
                            className={cn(
                              "w-3 shrink-0 text-center font-mono text-[10px] font-semibold",
                              file.change === "added" && "text-emerald-600 dark:text-emerald-400",
                              file.change === "modified" && "text-amber-600 dark:text-amber-400",
                              file.change === "deleted" && "text-destructive",
                            )}
                          >
                            {CHANGE_LABEL[file.change]}
                          </span>
                          {file.change === "deleted" ? (
                            <span className="truncate font-mono text-muted-foreground line-through">{file.path}</span>
                          ) : (
                            <button
                              type="button"
                              className={cn(
                                "truncate text-left font-mono hover:underline",
                                active ? "text-foreground" : "text-primary",
                              )}
                              onClick={() => {
                                setOpen(false);
                                go(projectId, file.path, { env: worktree.environmentId });
                              }}
                            >
                              {file.path}
                            </button>
                          )}
                        </li>
                      );
                    })}
                    {worktree.truncated ? <li className="text-muted-foreground">… and more</li> : null}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
