// "2 worktrees changed the space": threads in worktrees write their own copy
// of `.bb-space/`, which the Space page (the main checkout) does not show.
// The popover lists each worktree's branch, threads and changed files; a
// file opens read-only from that worktree. **Copy** puts the worktree's
// version into the main space. A file that main changed too needs a second
// click, because the copy replaces main's change. Nothing is merged.
import { useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { SpaceWorktree } from "../../server";
import { useWorktreeCopy, type WorktreeFile } from "../data";
import { useSpaceNavigation } from "./routing";

const CHANGE_LABEL = { added: "A", modified: "M", deleted: "D" } as const;
const CHANGE_TITLE = {
  added: "Added in this worktree",
  modified: "Differs from the main space",
  deleted: "Deleted in this worktree",
} as const;

/** A copy of this file replaces nothing that the main space changed. */
const isSafe = (file: WorktreeFile) => file.mainChanged === false;

function mainNote(file: WorktreeFile): string | null {
  if (file.mainChanged === true) return "main changed it too";
  if (file.mainChanged === null) return "main not checked";
  return null;
}

/**
 * **Copy** for one file. If the copy can replace a change in main, the first
 * click asks, and the second click copies.
 */
export function CopyFileButton({
  file,
  busy,
  copy,
  label = "Copy",
}: {
  file: WorktreeFile;
  busy: boolean;
  copy: (files: WorktreeFile[]) => Promise<boolean>;
  label?: string;
}) {
  const [asking, setAsking] = useState(false);
  const verb = file.change === "deleted" ? "Delete" : "Replace";
  return (
    <Button
      size="sm"
      variant={asking ? "destructive" : "outline"}
      className="h-6 shrink-0 px-2 text-[11px]"
      disabled={busy}
      aria-label={asking ? `${verb} main version of ${file.path}?` : `${label} ${file.path}`}
      onClick={() => {
        if (!isSafe(file) && !asking) {
          setAsking(true);
          return;
        }
        setAsking(false);
        void copy([file]);
      }}
    >
      {asking ? `${verb} main version?` : label}
    </Button>
  );
}

function WorktreeCard({
  projectId,
  worktree,
  activeEnv,
  activePath,
  close,
}: {
  projectId: string;
  worktree: SpaceWorktree;
  activeEnv: string | null;
  activePath: string | null;
  close: () => void;
}) {
  const go = useSpaceNavigation();
  const navigate = useBbNavigate();
  const { copy, busy, message } = useWorktreeCopy(projectId, worktree.environmentId);
  const safe = worktree.files.filter(isSafe);
  return (
    <li className="rounded-md border border-border p-2">
      <div className="flex items-center gap-1.5 font-mono text-[11px] text-foreground">
        <Icon name="GitBranch" className="size-3 shrink-0" />
        <span className="flex-1 truncate">{worktree.branch ?? worktree.environmentId}</span>
        {safe.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 shrink-0 px-2 font-sans text-[11px]"
            disabled={busy}
            onClick={() => void copy(safe)}
          >
            {safe.length === worktree.files.length ? "Copy all" : `Copy ${safe.length} safe`}
          </Button>
        ) : null}
      </div>
      {worktree.threads.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {worktree.threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                className="truncate text-left text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => {
                  close();
                  navigate.toThread(thread.id);
                }}
              >
                {thread.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="mt-2 space-y-1">
        {worktree.files.map((file) => {
          const active = activeEnv === worktree.environmentId && activePath === file.path;
          const note = mainNote(file);
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
              <span className="flex min-w-0 flex-1 flex-col">
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
                      close();
                      go(projectId, file.path, { env: worktree.environmentId });
                    }}
                  >
                    {file.path}
                  </button>
                )}
                {note !== null ? (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400">{note}</span>
                ) : null}
              </span>
              <CopyFileButton file={file} busy={busy} copy={copy} />
            </li>
          );
        })}
        {worktree.truncated ? <li className="text-muted-foreground">… and more</li> : null}
      </ul>
      {message !== null ? (
        <p role="status" className="mt-2 text-muted-foreground">
          {message}
        </p>
      ) : null}
    </li>
  );
}

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
            className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-[28rem] overflow-y-auto rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg"
          >
            <p className="mb-3 text-muted-foreground">
              Threads in these worktrees wrote their own copy of the space. The page
              shows the main checkout. Open a file to read the worktree's version.
              Click Copy to put it into the main space.
            </p>
            <ul className="space-y-3">
              {worktrees.map((worktree) => (
                <WorktreeCard
                  key={worktree.environmentId}
                  projectId={projectId}
                  worktree={worktree}
                  activeEnv={activeEnv}
                  activePath={activePath}
                  close={() => setOpen(false)}
                />
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
