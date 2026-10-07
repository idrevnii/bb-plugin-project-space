// Sending annotations to a thread (the Review tab's *Send to…*) and marking
// them sent. Three transports reach a thread: this module's
// `annotations_send` (server `bb.sdk.threads.send`), a composer on screen, and
// a new thread prefilled through `toCompose`. Only the first knows its thread
// up front, so a `message.dispatch` hook marks the annotations of every
// review message as sent to the thread it is dispatched to, whichever way it
// got there. The message format is in lib/review.ts.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Annotation } from "../lib/annotations";
import { annotationIdsIn, reviewMessage } from "../lib/review";
import { annotationStore, notifyAnnotations } from "./annotations";
import { defineModule } from "./context";
import { projectId, type ProjectSpace } from "./space";

/** More than this in one message is not a review an agent can act on. */
const MAX_SEND = 200;

export const sendContract = defineRpcContract({
  annotations_send: {
    input: z.object({
      projectId,
      ids: z.array(z.string().min(1).max(128)).min(1).max(MAX_SEND),
      threadId: z.string().min(1).max(128),
    }),
    output: z.object({ sent: z.number().int(), text: z.string() }),
  },
});

/**
 * Marks annotations sent to `threadId`. Resolved ones stay resolved, and ones
 * already sent to that thread are left alone, so a re-dispatch writes nothing.
 * Unknown ids are skipped. Returns the annotations it changed.
 */
export async function markSent(
  bb: BbPluginApi,
  space: ProjectSpace,
  ids: readonly string[],
  threadId: string,
): Promise<Annotation[]> {
  const store = annotationStore(bb.sdk.files, space);
  const wanted = new Set(ids);
  const due = (await store.list()).filter(
    (each) =>
      wanted.has(each.id) &&
      each.status !== "resolved" &&
      !(each.status === "sent" && each.sentTo?.threadId === threadId),
  );
  const at = Date.now();
  const changed: Annotation[] = [];
  for (const each of due) {
    changed.push(await store.update(each.id, { status: "sent", sentTo: { threadId, at } }));
  }
  notifyAnnotations(bb, space.projectId, changed.map((each) => each.path));
  return changed;
}

export const sendModule = defineModule({
  contract: sendContract,
  register({ bb, resolveSpace }) {
    // Decides nothing: always proceeds, at once, and marks in the background.
    // A throw here would fail the user's send, so nothing may escape.
    bb.experimental_hooks.on("message.dispatch", (ctx) => {
      try {
        const ids = annotationIdsIn(ctx.input.text);
        if (ids.length > 0) {
          void resolveSpace(ctx.project.id)
            .then((space) => markSent(bb, space, ids, ctx.thread.id))
            .catch((error) => bb.log.warn(`could not mark annotations sent: ${String(error)}`));
        }
      } catch (error) {
        bb.log.warn(`review message check failed: ${String(error)}`);
      }
      return { action: "proceed" };
    });

    return {
      rpc: {
        annotations_send: async ({ projectId: id, ids, threadId }) => {
          const space = await resolveSpace(id);
          const thread = await bb.sdk.threads.get({ threadId });
          if (thread.projectId !== space.projectId) {
            throw new Error(`Thread ${threadId} is not in this project.`);
          }
          const all = await annotationStore(bb.sdk.files, space).list();
          const picked = ids.map((each) => {
            const found = all.find((annotation) => annotation.id === each);
            if (found === undefined) throw new Error(`No annotation ${each}`);
            return found;
          });
          const text = reviewMessage(picked);
          await bb.sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text, mentions: [] }] });
          await markSent(bb, space, ids, threadId);
          return { sent: picked.length, text };
        },
      },
    };
  },
});
