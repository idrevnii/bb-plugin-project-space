// The right-panel Review tab: the project's annotations grouped by file, and
// *Send to…*, which takes the open ones (or the ticked ones) to an agent —
// into a composer on screen, to a thread of this project through the server,
// or into a new thread's composer. The server marks them sent when the
// message is dispatched (server/send.ts).
import { useMemo, useState } from "react";
import {
  experimental_useSidebarThreads,
  useBbNavigate,
  useComposers,
  type PluginComposerApi,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Annotation } from "../lib/annotations";
import { reviewGroups, reviewMessage } from "../lib/review";
import { requestAnnotationFocus } from "./annotate/focus";
import { errorMessage, useProjectAnnotations, useSpaceInfo, useSpaceRpc } from "./data";
import { Centered } from "./page/Centered";
import { parseRoute, useSpaceNavigation } from "./page/routing";

/** Threads listed in the picker before the filter has to narrow them. */
const MAX_THREADS = 30;

type Notice = { kind: "ok"; text: string; threadId?: string } | { kind: "error"; text: string };

function placeOf(annotation: Annotation): string {
  const { anchor } = annotation;
  if (anchor.kind === "text-quote") return anchor.exact.replace(/\s+/g, " ");
  if (anchor.kind === "shapes") return anchor.shapeIds.length === 1 ? "1 shape" : `${anchor.shapeIds.length} shapes`;
  return "Whole file";
}

const plural = (count: number) => (count === 1 ? "1 comment" : `${count} comments`);

export function ReviewTab({ subPath }: { subPath: string }) {
  const route = parseRoute(subPath);
  const { info } = useSpaceInfo(route.projectId);
  const projectId = info?.exists ? info.projectId : null;
  const { annotations, error } = useProjectAnnotations(projectId);

  if (route.projectId === null || info === null) return <Centered>Pick a project to review its comments.</Centered>;
  if (!info.exists) return <Centered>This project has no space yet.</Centered>;
  if (error !== null) return <Centered><span className="text-destructive">{error}</span></Centered>;
  if (annotations === null) return <Centered>Loading…</Centered>;
  if (annotations.length === 0) {
    return <Centered>No comments yet. Select text on a page and press Comment.</Centered>;
  }
  return <Review projectId={info.projectId} annotations={annotations} activePath={route.path} />;
}

function Review({
  projectId,
  annotations,
  activePath,
}: {
  projectId: string;
  annotations: Annotation[];
  activePath: string;
}) {
  const go = useSpaceNavigation();
  const groups = useMemo(() => reviewGroups(annotations), [annotations]);
  const open = annotations.filter((each) => each.status === "open");
  // null: the default, every open comment. Ticking makes it explicit.
  const [ticked, setTicked] = useState<ReadonlySet<string> | null>(null);
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const picked = annotations.filter((each) =>
    ticked === null ? each.status === "open" : ticked.has(each.id) && each.status !== "resolved",
  );

  const toggle = (id: string) => {
    const next = new Set(ticked ?? open.map((each) => each.id));
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
  };
  const show = (annotation: Annotation) => {
    go(projectId, annotation.path);
    requestAnnotationFocus(projectId, annotation.path, annotation.id);
  };
  const done = (next: Notice) => {
    setNotice(next);
    if (next.kind === "ok") {
      setMenu(false);
      setTicked(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex-1 text-sm text-foreground" data-testid="review-open-count">
          {open.length === 0 ? "No open comments" : `${open.length} open`}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          disabled={picked.length === 0}
          aria-expanded={menu}
          onClick={() => {
            setNotice(null);
            setMenu(!menu);
          }}
        >
          Send to…
        </Button>
      </div>
      {menu && picked.length > 0 ? (
        <SendMenu projectId={projectId} picked={picked} onDone={done} onClose={() => setMenu(false)} />
      ) : null}
      {notice !== null ? (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={cn(
            "flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs",
            notice.kind === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <span className="flex-1">{notice.text}</span>
          {notice.kind === "ok" && notice.threadId !== undefined ? <OpenThread threadId={notice.threadId} /> : null}
        </div>
      ) : null}
      <nav aria-label="Review" className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.map((group) => (
          <section key={group.path} className="mb-3" data-review-path={group.path}>
            <button
              type="button"
              title={group.path}
              onClick={() => go(projectId, group.path)}
              className={cn(
                "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left font-mono text-xs hover:bg-state-hover",
                group.path === activePath ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{group.path}</span>
              {group.open > 0 ? <span className="shrink-0 tabular-nums">{group.open}</span> : null}
            </button>
            <ul className="flex flex-col gap-0.5">
              {group.annotations.map((annotation) => (
                <ReviewItem
                  key={annotation.id}
                  annotation={annotation}
                  checked={picked.some((each) => each.id === annotation.id)}
                  onToggle={() => toggle(annotation.id)}
                  onShow={() => show(annotation)}
                />
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </div>
  );
}

function ReviewItem({
  annotation,
  checked,
  onToggle,
  onShow,
}: {
  annotation: Annotation;
  checked: boolean;
  onToggle: () => void;
  onShow: () => void;
}) {
  const resolved = annotation.status === "resolved";
  return (
    <li data-annotation-id={annotation.id} data-status={annotation.status} className="flex items-start gap-1.5 rounded-md px-1 hover:bg-state-hover">
      <input
        type="checkbox"
        className="mt-2 shrink-0"
        aria-label={`Send “${annotation.comment.slice(0, 40)}”`}
        checked={checked}
        disabled={resolved}
        onChange={onToggle}
      />
      <button type="button" onClick={onShow} className="min-w-0 flex-1 py-1 text-left">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate italic">{placeOf(annotation)}</span>
          {annotation.status !== "open" ? (
            <span className="shrink-0 rounded bg-muted px-1 uppercase tracking-wide">{annotation.status}</span>
          ) : null}
        </span>
        <span className={cn("line-clamp-2 text-sm", resolved ? "text-muted-foreground" : "text-foreground")}>
          {annotation.comment}
        </span>
        {annotation.resolution ? (
          <span className="line-clamp-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">
            {annotation.resolution}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function OpenThread({ threadId }: { threadId: string }) {
  const navigate = useBbNavigate();
  return (
    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => navigate.toThread(threadId)}>
      Open thread
    </Button>
  );
}

function SendMenu({
  projectId,
  picked,
  onDone,
  onClose,
}: {
  projectId: string;
  picked: Annotation[];
  onDone: (notice: Notice) => void;
  onClose: () => void;
}) {
  const rpc = useSpaceRpc();
  const navigate = useBbNavigate();
  const composers = useComposers();
  const sidebar = experimental_useSidebarThreads();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const threads = sidebar.threads.filter((thread) => thread.projectId === projectId);
  const titleOf = (threadId: string) => sidebar.threads.find((thread) => thread.id === threadId)?.displayTitle;
  const projectOf = (threadId: string) => sidebar.threads.find((thread) => thread.id === threadId)?.projectId;
  const here = composers.filter((composer) =>
    composer.scope.kind === "new-thread"
      ? composer.scope.projectId === null || composer.scope.projectId === projectId
      : (projectOf(composer.scope.threadId) ?? projectId) === projectId,
  );
  const needle = filter.trim().toLowerCase();
  const matching = threads.filter((thread) => needle === "" || thread.displayTitle.toLowerCase().includes(needle));
  const text = () => reviewMessage(picked);
  const what = plural(picked.length);

  const label = (composer: PluginComposerApi) => {
    const { scope } = composer;
    if (scope.kind === "new-thread") return "New thread composer";
    const title = titleOf(scope.threadId) ?? "a thread";
    return scope.kind === "queued-message" ? `Queued message · ${title}` : title;
  };
  const insert = (composer: PluginComposerApi) => {
    try {
      composer.insert(text(), { at: "end", block: true });
      composer.focus();
      onDone({ kind: "ok", text: `Added ${what} to the composer. Send it from there.` });
    } catch (cause) {
      onDone({ kind: "error", text: errorMessage(cause) });
    }
  };
  const send = (threadId: string) => {
    setBusy(true);
    rpc.call("annotations_send", { projectId, ids: picked.map((each) => each.id), threadId }).then(
      () => onDone({ kind: "ok", text: `Sent ${what} to ${titleOf(threadId) ?? "the thread"}.`, threadId }),
      (cause) => {
        setBusy(false);
        onDone({ kind: "error", text: errorMessage(cause) });
      },
    );
  };

  const heading = (title: string) => (
    <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
  );
  const row = (key: string, title: string, onClick: () => void, icon?: string, threadId?: string) => (
    <li key={key}>
      <button
        type="button"
        data-thread-id={threadId}
        disabled={busy}
        onClick={onClick}
        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground hover:bg-state-hover disabled:opacity-50"
      >
        {icon !== undefined ? <Icon name={icon} className="size-3.5 shrink-0 text-muted-foreground" /> : null}
        <span className="truncate">{title}</span>
      </button>
    </li>
  );

  return (
    <div
      role="dialog"
      aria-label="Send to"
      className="flex max-h-[60%] shrink-0 flex-col border-b border-border bg-popover"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="px-3 pt-2 text-xs text-muted-foreground">Send {what} to…</div>
      <div className="min-h-0 overflow-y-auto px-1 pb-2">
        <ul>{row("new", "New thread", () => navigate.toCompose({ initialPrompt: text(), focusPrompt: true }), "MessageSquarePlus")}</ul>
        {here.length > 0 ? (
          <>
            {heading("Composer on screen")}
            <ul aria-label="Composers">
              {here.map((composer) => row(composer.key, label(composer), () => insert(composer), "MessageSquare"))}
            </ul>
          </>
        ) : null}
        {heading("Thread of this project")}
        {threads.length > 8 ? (
          <div className="px-1 pb-1">
            <Input
              value={filter}
              placeholder="Filter threads"
              aria-label="Filter threads"
              className="h-7 text-xs"
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
        ) : null}
        {sidebar.status === "loading" ? (
          <div className="px-2 text-xs text-muted-foreground">Loading…</div>
        ) : matching.length === 0 ? (
          <div className="px-2 text-xs text-muted-foreground">No threads.</div>
        ) : (
          <ul aria-label="Threads">
            {matching.slice(0, MAX_THREADS).map((thread) => row(thread.id, thread.displayTitle, () => send(thread.id), undefined, thread.id))}
          </ul>
        )}
      </div>
    </div>
  );
}
