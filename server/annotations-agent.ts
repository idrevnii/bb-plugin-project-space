// The agent side of annotations: `bb space annotations list|show|resolve|reply`
// and the `space_annotations` tool. They close the loop the Review tab opens:
// the user sends comments, the agent reads each, changes the file, resolves
// it. Output is formatted in lib/annotation-text.ts and stays under 64 KB.
import { PluginCliError, cliCommand, defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  filterAnnotations,
  listJson,
  listText,
  showText,
  type AnnotationFilter,
} from "../lib/annotation-text";
import { MAX_COMMENT_LENGTH, type Annotation } from "../lib/annotations";
import { normalizeSpacePath } from "../lib/space";
import { annotationStore, notifyAnnotations } from "./annotations";
import { projectOption, requireProject } from "./cli";
import { defineModule } from "./context";

const STATUSES = ["open", "sent", "resolved"] as const;

export const annotationsAgentModule = defineModule({
  /** Nothing for the app: storage and the RPC are in server/annotations.ts. */
  contract: defineRpcContract({}),
  register({ bb, resolveSpace, readText }) {
    async function storeFor(projectId: string) {
      const space = await resolveSpace(projectId);
      return { space, store: annotationStore(bb.sdk.files, space) };
    }

    async function list(projectId: string, filter: AnnotationFilter): Promise<Annotation[]> {
      const { store } = await storeFor(projectId);
      return filterAnnotations(await store.list(filter.path), filter);
    }

    async function show(projectId: string, id: string): Promise<string> {
      const { space, store } = await storeFor(projectId);
      const annotation = (await store.list()).find((each) => each.id === id);
      if (annotation === undefined) throw notFound(id);
      const text =
        annotation.anchor.kind === "text-quote" ? await readText(space, annotation.path) : null;
      return showText(annotation, text);
    }

    async function update(
      projectId: string,
      id: string,
      patch: Pick<Annotation, "resolution"> & Partial<Pick<Annotation, "status">>,
    ): Promise<Annotation> {
      const { space, store } = await storeFor(projectId);
      let annotation: Annotation;
      try {
        annotation = await store.update(id, patch);
      } catch (cause) {
        if (cause instanceof Error && cause.message === `No annotation ${id}`) throw notFound(id);
        throw cause;
      }
      notifyAnnotations(bb, space.projectId, [annotation.path]);
      return annotation;
    }

    const resolve = (projectId: string, id: string, note: string | undefined) =>
      update(projectId, id, { status: "resolved", resolution: cleanNote(note) });

    bb.agents.registerTool({
      name: "space_annotations",
      description:
        "Comments the user pinned to passages, shapes or whole files in the project space " +
        "(.bb-space/) and usually sent you from bb's Review tab with their ann_… ids. " +
        "action 'list' prints one line per annotation (filter by space-relative path and status " +
        "open|sent|resolved); 'show' prints one annotation's comment and the quoted passage with " +
        "3 lines of the file's current text around it; 'resolve' marks it done with a one-line " +
        "note, which the user sees in the Review tab. Read each with show, change the file, then " +
        "resolve it.",
      presentation: {
        label: { pending: "Reading space annotations", completed: "Read space annotations" },
      },
      parameters: z.object({
        action: z.enum(["list", "show", "resolve"]),
        id: z.string().min(1).max(128).optional().describe("Annotation id (ann_…), for show and resolve"),
        path: z.string().max(1024).optional().describe("list: only this space-relative file"),
        status: z.enum(STATUSES).optional().describe("list: only this status"),
        note: z.string().max(MAX_COMMENT_LENGTH).optional().describe("resolve: what you changed, one line"),
      }),
      async execute({ action, id, path, status, note }, ctx) {
        try {
          if (action === "list") {
            const filter = { ...spacePathFilter(path), ...(status ? { status } : {}) };
            return listText(await list(ctx.projectId, filter));
          }
          if (id === undefined) throw new Error(`action '${action}' needs an id (ann_…).`);
          if (action === "show") return await show(ctx.projectId, id);
          const resolved = await resolve(ctx.projectId, id, note);
          return `Resolved ${resolved.id} on ${resolved.path}.`;
        } catch (cause) {
          return { content: [{ type: "text", text: String(cause instanceof Error ? cause.message : cause) }], isError: true };
        }
      },
    });

    const idPositional = { name: "id", description: "Annotation id (ann_…)", required: true } as const;

    const cli = {
      "annotations list": cliCommand({
        summary:
          "List annotations the user left in the space, open first, one line each: id, status, path, quote, comment",
        options: {
          project: projectOption,
          path: { type: "string", description: "Only annotations on this space-relative file" },
          status: { type: "enum", values: STATUSES, description: "Only this status" },
          json: { type: "boolean", description: "Emit JSON: { annotations, total, truncated }" },
        },
        async run(input, ctx) {
          const projectId = requireProject(input.options.project, ctx);
          const filter = {
            ...spacePathFilter(input.options.path),
            ...(input.options.status ? { status: input.options.status } : {}),
          };
          const annotations = await list(projectId, filter);
          return {
            exitCode: 0,
            stdout: input.options.json ? listJson(annotations) : listText(annotations),
          };
        },
      }),
      "annotations show": cliCommand({
        summary:
          "Print one annotation: its comment, anchor, and the quoted passage with 3 lines of the file's current text around it",
        positionals: [idPositional],
        options: { project: projectOption },
        async run(input, ctx) {
          const projectId = requireProject(input.options.project, ctx);
          return { exitCode: 0, stdout: await show(projectId, input.positionals.id) };
        },
      }),
      "annotations resolve": cliCommand({
        summary: "Mark an annotation resolved, with a one-line note the user sees in the Review tab",
        positionals: [idPositional],
        options: {
          project: projectOption,
          note: { type: "string", description: "What you changed, one line (keeps an earlier reply when omitted)" },
        },
        async run(input, ctx) {
          const projectId = requireProject(input.options.project, ctx);
          const resolved = await resolve(projectId, input.positionals.id, input.options.note);
          return { exitCode: 0, stdout: `Resolved ${resolved.id} on ${resolved.path}.` };
        },
      }),
      "annotations reply": cliCommand({
        summary: "Answer an annotation without resolving it, e.g. to ask the user a question",
        positionals: [
          idPositional,
          { name: "text", description: "The reply", required: true, variadic: true },
        ],
        options: { project: projectOption },
        async run(input, ctx) {
          const projectId = requireProject(input.options.project, ctx);
          const text = input.positionals.text.join(" ").trim();
          if (text === "") throw new PluginCliError("empty reply", { code: "reply_required" });
          const answered = await update(projectId, input.positionals.id, {
            resolution: clipNote(text),
          });
          return { exitCode: 0, stdout: `Replied on ${answered.id} (${answered.status}).` };
        },
      }),
    };

    return { rpc: {}, cli };
  },
});

function notFound(id: string): PluginCliError {
  return new PluginCliError(`No annotation ${id}`, {
    code: "annotation_not_found",
    hint: "`bb space annotations list` shows the ids.",
  });
}

function spacePathFilter(path: string | undefined): AnnotationFilter {
  if (path === undefined) return {};
  const normalized = normalizeSpacePath(path);
  if (normalized === null || normalized === "") {
    throw new PluginCliError(`invalid space path: ${path}`, {
      code: "invalid_path",
      hint: "Use a path relative to the space root without `..`.",
    });
  }
  return { path: normalized };
}

const clipNote = (text: string) => text.slice(0, MAX_COMMENT_LENGTH);

/** A note to store, or undefined to keep the one already there. */
function cleanNote(note: string | undefined): string | undefined {
  const trimmed = note?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : clipNote(trimmed);
}
