// `space_search` and `bb space search`: find a page by name (the host's fuzzy
// path match) or by text inside it (a case-insensitive scan of text files and
// canvas labels). No index: name matches come first, then content hits in
// path order, until the limit or the time budget runs out.
import { readFile, stat } from "node:fs/promises";
import {
  PluginCliError,
  cliCommand,
  defineRpcContract,
  type PluginRpcHandlers,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { isSearchablePath, looksBinary, matchFile } from "../lib/search";
import { normalizeSpacePath } from "../lib/space";
import { projectOption, requireProject } from "./cli";
import { defineModule } from "./context";
import { absolute, projectId, type ProjectSpace } from "./space";

const resultSchema = z.object({
  path: z.string(),
  kind: z.enum(["name", "content"]),
  line: z.number().optional(),
  snippet: z.string().optional(),
});
export type SpaceSearchResult = z.infer<typeof resultSchema>;

const searchOutputSchema = z.object({
  results: z.array(resultSchema),
  /** True when the limit, the time budget, or the file count cut it short. */
  truncated: z.boolean(),
});
export type SpaceSearchOutput = z.infer<typeof searchOutputSchema>;

export const MAX_RESULTS = 50;
const BUDGET_MS = 2000;
const MAX_FILE_BYTES = 1024 * 1024;
const FILE_LIMIT = 5000;
const READ_CONCURRENCY = 16;

export const searchContract = defineRpcContract({
  space_search: {
    input: z.object({
      projectId,
      query: z.string().max(200),
      limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
    }),
    output: searchOutputSchema,
  },
});

export const searchModule = defineModule({
  contract: searchContract,
  register({ bb, resolveSpace }) {
    /** Space-relative paths from a listPaths result, hidden files left out. */
    function spacePaths(paths: { path: string }[]): string[] {
      return paths
        .map((entry) => normalizeSpacePath(entry.path))
        .filter((path): path is string => path !== null && path !== "");
    }

    /** A file's text, or null when it is binary, too big, or unreadable. */
    async function readSearchable(
      space: ProjectSpace,
      path: string,
      signal: AbortSignal,
    ): Promise<string | null> {
      try {
        if (space.isLocal) {
          // Same machine: skip big files before reading them.
          const file = absolute(space, path);
          if ((await stat(file)).size > MAX_FILE_BYTES) return null;
          const text = await readFile(file, { encoding: "utf8", signal });
          return looksBinary(text) ? null : text;
        }
        const file = await bb.sdk.files.read({
          hostId: space.hostId,
          path: absolute(space, path),
          rootPath: space.rootPath,
          signal,
        });
        if (file.sizeBytes > MAX_FILE_BYTES || file.contentEncoding !== "utf8") return null;
        return looksBinary(file.content) ? null : file.content;
      } catch {
        return null;
      }
    }

    async function search(
      id: string,
      rawQuery: string,
      limit = MAX_RESULTS,
    ): Promise<SpaceSearchOutput> {
      const query = rawQuery.trim();
      if (query === "") return { results: [], truncated: false };
      const deadline = Date.now() + BUDGET_MS;
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), BUDGET_MS);
      try {
        const space = await resolveSpace(id);
        const listing = { hostId: space.hostId, path: space.rootPath, includeHidden: false };
        const [named, all] = await Promise.all([
          bb.sdk.files.listPaths({
            ...listing,
            query,
            includeFiles: true,
            includeDirectories: false,
            limit,
            signal: timeout.signal,
          }),
          bb.sdk.files.listPaths({
            ...listing,
            includeFiles: true,
            includeDirectories: false,
            limit: FILE_LIMIT,
            signal: timeout.signal,
          }),
        ]);

        const results: SpaceSearchResult[] = spacePaths(named.paths).map((path) => ({
          path,
          kind: "name",
        }));
        let truncated = named.truncated || all.truncated;

        const files = spacePaths(all.paths)
          .filter(isSearchablePath)
          .sort((a, b) => a.localeCompare(b));
        let next = 0;
        // Batches in path order, so results do not depend on read timing.
        while (next < files.length && results.length < limit) {
          if (Date.now() >= deadline) {
            truncated = true;
            break;
          }
          const batch = files.slice(next, next + READ_CONCURRENCY);
          next += batch.length;
          const texts = await Promise.all(
            batch.map((path) => readSearchable(space, path, timeout.signal)),
          );
          batch.forEach((path, index) => {
            const text = texts[index];
            if (text === null || text === undefined) return;
            for (const hit of matchFile(path, text, query)) {
              if (results.length >= limit) {
                truncated = true;
                return;
              }
              results.push({ path, kind: "content", ...hit });
            }
          });
          if (timeout.signal.aborted) truncated = true;
        }
        if (next < files.length) truncated = true;
        return { results, truncated };
      } finally {
        clearTimeout(timer);
      }
    }

    const rpc: PluginRpcHandlers<typeof searchContract> = {
      space_search: ({ projectId: id, query, limit }) => search(id, query, limit),
    };

    const cli = {
      search: cliCommand({
        summary:
          "Find space files by name, then by text inside them (canvases by label); up to 50 results within ~2 s",
        positionals: [
          { name: "query", description: "Text to look for (any case)", required: true, variadic: true },
        ],
        options: {
          project: projectOption,
          limit: {
            type: "integer",
            min: 1,
            max: MAX_RESULTS,
            description: `Most results to return (default ${MAX_RESULTS})`,
          },
          json: { type: "boolean", description: "Emit JSON" },
        },
        async run(input, ctx) {
          const id = requireProject(input.options.project, ctx);
          const query = input.positionals.query.join(" ").trim();
          if (query === "") {
            throw new PluginCliError("empty query", { code: "query_required" });
          }
          const result = await search(id, query, input.options.limit);
          if (input.options.json) return { exitCode: 0, stdout: JSON.stringify(result) };
          const lines = result.results.map((hit) =>
            hit.kind === "name"
              ? hit.path
              : `${hit.path}${hit.line === undefined ? "" : `:${hit.line}`}: ${hit.snippet ?? ""}`,
          );
          if (result.truncated) lines.push("… (more results not shown; narrow the query)");
          return {
            exitCode: 0,
            stdout: lines.length === 0 ? `No matches for "${query}".` : lines.join("\n"),
          };
        },
      }),
    };

    return { rpc, cli };
  },
});
