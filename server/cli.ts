// CLI: `bb space …`. Feature modules contribute subcommands (see
// server/context.ts); this file merges them with the shared ones and holds
// the helpers they use.
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliCommand,
} from "@get-bb/plugin-sdk";
import { joinSpacePath, normalizeSpacePath } from "../lib/space";

export const projectOption = {
  type: "string",
  description:
    "Project id (proj_…). Defaults to the project of the calling thread.",
  aliases: ["project-id"],
} as const;

export function requireProject(
  explicit: string | undefined,
  ctx: { projectId?: string },
): string {
  const id = explicit ?? ctx.projectId;
  if (id === undefined || id === "") {
    throw new PluginCliError("no project in context", {
      code: "project_required",
      hint: "Pass --project <proj_id>; `bb project list` shows ids.",
    });
  }
  return id;
}

/** An absolute path for a file named on the command line by `flag`. */
function invokerPath(file: string, ctx: { cwd?: string }, flag: string): string {
  if (file.startsWith("/")) return file;
  if (ctx.cwd) return `${ctx.cwd.replace(/\/+$/, "")}/${file}`;
  throw new PluginCliError(`relative ${flag} without a working directory`, {
    code: "invalid_path",
    hint: "Pass an absolute path.",
  });
}

/** The host of the calling thread's environment, if there is one. */
async function invokerHost(
  bb: BbPluginApi,
  ctx: { threadId?: string },
): Promise<{ hostId?: string }> {
  if (!ctx.threadId) return {};
  try {
    const thread = await bb.sdk.threads.get({ threadId: ctx.threadId });
    const hostId = (thread as { environment?: { hostId?: string } | null }).environment?.hostId;
    return hostId ? { hostId } : {};
  } catch {
    return {};
  }
}

/** Reads a file named on the command line from the machine that ran `bb`. */
export async function readInvokerFile(
  bb: BbPluginApi,
  file: string,
  ctx: { cwd?: string; threadId?: string },
): Promise<string> {
  const path = invokerPath(file, ctx, "--spec-file");
  try {
    const result = await bb.sdk.files.read({ ...(await invokerHost(bb, ctx)), path });
    return result.contentEncoding === "utf8"
      ? result.content
      : Buffer.from(result.content, "base64").toString("utf8");
  } catch (cause) {
    throw new PluginCliError(`cannot read ${path}: ${String(cause)}`, { code: "file_unreadable" });
  }
}

/**
 * Writes base64 content to a file named on the command line by `flag`, on the
 * machine that ran `bb`. Returns the absolute path written.
 */
export async function writeInvokerFile(
  bb: BbPluginApi,
  file: string,
  base64: string,
  ctx: { cwd?: string; threadId?: string },
  flag: string,
): Promise<string> {
  const path = invokerPath(file, ctx, flag);
  try {
    await bb.sdk.files.write({
      ...(await invokerHost(bb, ctx)),
      path,
      content: base64,
      contentEncoding: "base64",
      createParents: true,
    });
  } catch (cause) {
    throw new PluginCliError(`cannot write ${path}: ${String(cause)}`, { code: "file_unwritable" });
  }
  return path;
}

const link = cliCommand({
  summary:
    "Print the ::space directive that shows a space file as a card in chat",
  positionals: [
    { name: "path", description: "Space-relative file path, e.g. architecture/overview.md", required: true },
  ],
  options: {
    project: projectOption,
    title: { type: "string", description: "Card title" },
  },
  async run(input, ctx) {
    const id = requireProject(input.options.project, ctx);
    const path = normalizeSpacePath(input.positionals.path);
    if (path === null || path === "") {
      throw new PluginCliError(`invalid space path: ${input.positionals.path}`, {
        code: "invalid_path",
        hint: "Use a path relative to the space root without `..`.",
      });
    }
    const title = input.options.title?.replace(/"/g, "'");
    return {
      exitCode: 0,
      stdout: `::space{project="${id}" path="${joinSpacePath(path)}"${title ? ` title="${title}"` : ""}}`,
    };
  },
});

/** Registers `bb space` with the modules' commands, in module order. */
export function registerCli(
  bb: BbPluginApi,
  commands: Record<string, PluginCliCommand>,
): void {
  bb.cli.register(
    defineCli({
      name: "space",
      summary: "Find and set up the project space (.bb-space) agents document a project in",
      commands: { ...commands, link },
    }),
  );
}
