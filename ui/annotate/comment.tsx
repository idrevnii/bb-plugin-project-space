// The comment popover's body, shared by every annotator (Markdown reader,
// canvas): a textarea that saves on Ctrl/⌘+Enter, and an existing comment
// with Edit, Resolve/Reopen and Delete.
import { useState } from "react";
import { useSettings } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { MAX_COMMENT_LENGTH, type Annotation } from "../../lib/annotations";
import { errorMessage, type SpaceRpc } from "../data";

export function CommentEditor({
  initial = "",
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  submitLabel: string;
  onSubmit: (comment: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (text.trim() === "" || busy) return;
    setBusy(true);
    try {
      await onSubmit(text.trim());
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <textarea
        autoFocus
        value={text}
        maxLength={MAX_COMMENT_LENGTH}
        aria-label="Comment"
        placeholder="Comment…"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        className="min-h-20 resize-y rounded-md border border-input bg-background p-2 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {error !== null ? <div role="alert" className="text-xs text-destructive">{error}</div> : null}
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[11px] text-muted-foreground">Ctrl/⌘+Enter</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="outline" disabled={text.trim() === "" || busy} onClick={() => void submit()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

export function CommentCard({
  annotation,
  rpc,
  projectId,
  onChanged,
  onClose,
}: {
  annotation: Annotation;
  rpc: SpaceRpc;
  projectId: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { values } = useSettings();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = (call: () => Promise<unknown>, close = false) => {
    call().then(
      () => {
        onChanged();
        if (close) onClose();
      },
      (cause) => setError(errorMessage(cause)),
    );
  };
  if (editing) {
    return (
      <CommentEditor
        initial={annotation.comment}
        submitLabel="Save"
        onCancel={() => setEditing(false)}
        onSubmit={async (comment) => {
          await rpc.call("annotations_update", { projectId, id: annotation.id, comment });
          onChanged();
          setEditing(false);
        }}
      />
    );
  }
  const resolved = annotation.status === "resolved";
  // The server deletes a comment on resolve when this setting is on (default).
  const deletesOnResolve = values?.autoDeleteResolved !== false;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{annotation.author === "agent" ? "Agent" : "You"}</span>
        <span>·</span>
        <span>{new Date(annotation.updatedAt).toLocaleString()}</span>
        {annotation.status !== "open" ? (
          <span className="ml-auto rounded bg-muted px-1.5 py-0.5 uppercase tracking-wide">{annotation.status}</span>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-sm text-foreground" data-testid="annotation-comment">
        {annotation.comment}
      </p>
      {annotation.resolution ? (
        <p className="whitespace-pre-wrap border-l-2 border-border pl-2 text-xs text-muted-foreground">
          {annotation.resolution}
        </p>
      ) : null}
      {error !== null ? <div role="alert" className="text-xs text-destructive">{error}</div> : null}
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            act(() =>
              rpc.call("annotations_update", { projectId, id: annotation.id, status: resolved ? "open" : "resolved" }),
              !resolved && deletesOnResolve,
            )
          }
        >
          {resolved ? "Reopen" : "Resolve"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-destructive"
          onClick={() => act(() => rpc.call("annotations_delete", { projectId, id: annotation.id }), true)}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
