// Project Space — backend.
//
// Every project gets a space: the `.bb-space/` directory in its default
// checkout. Agents write there with ordinary file tools; the app reads and
// edits it through the RPC the modules below register.
//
// Adding a feature: write a module with `defineModule` (server/context.ts)
// and add it to `modules`. Its contract joins `rpcContract`, its handlers
// and `bb space` subcommands register with the rest.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { annotationsModule } from "./annotations";
import { annotationsAgentModule } from "./annotations-agent";
import { canvasImageModule } from "./canvas-image";
import { registerCli } from "./cli";
import type { ServerContext } from "./context";
import { drawModule } from "./draw";
import { filesModule } from "./files";
import { searchModule } from "./search";
import { sendModule } from "./send";
import { createSpaces } from "./space";
import { worktreesModule } from "./worktrees";

export { SPACE_CHANGED } from "./space";
export { SPACE_DRAW, type DrawBatch } from "./draw";
export type {
  SpaceFile,
  SpaceInfo,
  SpaceTreeEntry,
  SpaceWriteResult,
} from "./files";
export type { SpaceSearchOutput, SpaceSearchResult } from "./search";
export type { SpaceWorktree, SpaceWorktreesOutput } from "./worktrees";

export { SPACE_ANNOTATIONS_CHANGED } from "../lib/annotations";

const modules = [
  filesModule,
  drawModule,
  canvasImageModule,
  annotationsModule,
  annotationsAgentModule,
  sendModule,
  searchModule,
  worktreesModule,
] as const;

type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;
type Contract = UnionToIntersection<(typeof modules)[number]["contract"]>;

/** Every module's methods in one contract; the app types its client with it. */
export const rpcContract = defineRpcContract(
  Object.assign({}, ...modules.map((module) => module.contract)) as Contract,
);

export type Settings = ReturnType<typeof defineSettings>;

function defineSettings(bb: BbPluginApi) {
  return bb.settings.define({
    treePosition: {
      type: "select",
      label: "File tree position",
      description:
        "Right puts the tree in the page's side panel; left keeps it beside the document.",
      options: ["right", "left"],
      default: "right",
    },
    readingStyle: {
      type: "select",
      label: "Reading style",
      description:
        "How Markdown pages look. Blue Topaz and Things follow the Obsidian themes of those names: headings colored by level, styled bold, italic, code and quotes. Plain keeps the neutral look.",
      options: ["blue-topaz", "things", "plain"],
      default: "blue-topaz",
    },
    tldrawLicenseKey: {
      type: "string",
      label: "tldraw license key",
      description:
        "Only needed when bb is opened over a non-local https address (for example bb connect). tldraw runs free on local addresses.",
      default: "",
    },
  });
}

export default async function plugin(bb: BbPluginApi) {
  const settings = defineSettings(bb);
  const ctx: ServerContext = { bb, settings, ...createSpaces(bb) };

  const parts = modules.map((module) => module.register(ctx));
  bb.rpc.register(rpcContract, Object.assign({}, ...parts.map((part) => part.rpc)));
  registerCli(bb, Object.assign({}, ...parts.map((part) => part.cli ?? {})));
}
