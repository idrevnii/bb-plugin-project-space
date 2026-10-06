// What every server module gets, and the shape it hands back. A module owns
// an RPC contract (spread into the plugin's one `rpcContract`), its handlers,
// and optionally `bb space` subcommands; `server/index.ts` lists the modules.
import type {
  BbPluginApi,
  PluginCliCommand,
  PluginRpcContract,
  PluginRpcHandlers,
} from "@get-bb/plugin-sdk";
import type { Settings } from "./index";
import type { Spaces } from "./space";

export interface ServerContext extends Spaces {
  bb: BbPluginApi;
  settings: Settings;
}

export interface ServerModule<Contract extends PluginRpcContract> {
  contract: Contract;
  register(ctx: ServerContext): {
    rpc: PluginRpcHandlers<Contract>;
    /** `bb space` subcommands, keyed by invocation path. */
    cli?: Record<string, PluginCliCommand>;
  };
}

export function defineModule<const Contract extends PluginRpcContract>(
  module: ServerModule<Contract>,
): ServerModule<Contract> {
  return module;
}
