import { FileTree } from "../FileTree";
import { useSpaceInfo, useSpaceRpc, useSpaceTree } from "../data";
import { Centered } from "./Centered";
import { parseRoute, useSpaceNavigation, useTreePosition } from "./routing";

/** The right-panel Files tab. */
export function FilesTab({ subPath }: { subPath: string }) {
  const route = parseRoute(subPath);
  const rpc = useSpaceRpc();
  const go = useSpaceNavigation();
  const treePosition = useTreePosition();
  const { info } = useSpaceInfo(route.projectId);
  const tree = useSpaceTree(info?.exists ? route.projectId : null, info?.watching ?? true);
  if (treePosition === "left") {
    return (
      <Centered>
        The file tree is beside the document. Switch it here with the plugin's
        "File tree position" setting.
      </Centered>
    );
  }
  if (route.projectId === null || info === null) {
    return <Centered>Pick a project to see its files.</Centered>;
  }
  if (!info.exists) return <Centered>This project has no space yet.</Centered>;
  return (
    <FileTree
      projectId={info.projectId}
      projectName={info.projectName}
      entries={tree.entries}
      truncated={tree.truncated}
      error={tree.error}
      activePath={route.path === "" ? null : route.path}
      rpc={rpc}
      onOpen={(next) => go(info.projectId, next)}
      onRefresh={tree.refetch}
    />
  );
}
