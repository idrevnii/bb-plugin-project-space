// The annotations_* RPC through `bb plugin rpc call`: create, list, update,
// rename the file with space_move (annotations follow), delete, and remove the
// file (its annotation file goes too). No browser. Cleans up its scratch file.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROJECT_ID, SPACE, bb, fail, ok } from "./lib.mjs";

const PATH = "scratch-e2e-annotations.md";
const RENAMED = "scratch-e2e-annotations-renamed.md";
const inputDir = mkdtempSync(join(tmpdir(), "space-e2e-"));

function call(method, input) {
  const file = join(inputDir, `${method}.json`);
  writeFileSync(file, JSON.stringify({ projectId: PROJECT_ID, ...input }));
  return JSON.parse(bb("plugin", "rpc", "call", "project-space", method, "--input-file", file, "--json"));
}

const annotationFile = (path) => join(SPACE, ".space", "annotations", `${path}.json`);
const ids = (path) => call("annotations_list", { path }).annotations.map((each) => each.id);

try {
  writeFileSync(join(SPACE, PATH), "# Scratch\n\nAn explicit route back to an agent.\n");

  const { annotation } = call("annotations_create", {
    path: PATH,
    anchor: { kind: "text-quote", exact: "route back", prefix: "An explicit ", suffix: " to an agent." },
    comment: "E2E comment",
  });
  if (!/^ann_/.test(annotation.id) || annotation.status !== "open") fail(`create: ${JSON.stringify(annotation)}`);
  if (!existsSync(annotationFile(PATH))) fail("create: annotation file missing");
  ok("created");

  if (!ids(PATH).includes(annotation.id)) fail("list by path: annotation missing");
  if (!call("annotations_list", {}).annotations.some((each) => each.id === annotation.id)) {
    fail("list all: annotation missing");
  }
  ok("listed");

  const updated = call("annotations_update", { id: annotation.id, status: "resolved", resolution: "Fixed" }).annotation;
  if (updated.status !== "resolved" || updated.resolution !== "Fixed" || updated.comment !== "E2E comment") {
    fail(`update: ${JSON.stringify(updated)}`);
  }
  ok("updated");

  call("space_move", { from: PATH, to: RENAMED });
  if (ids(PATH).length !== 0 || !ids(RENAMED).includes(annotation.id)) fail("move: annotation did not follow the file");
  if (existsSync(annotationFile(PATH))) fail("move: old annotation file left behind");
  ok("followed a rename");

  call("annotations_delete", { id: annotation.id });
  if (ids(RENAMED).length !== 0) fail("delete: annotation still listed");
  ok("deleted");

  call("annotations_create", { path: RENAMED, anchor: { kind: "file" }, comment: "E2E whole file" });
  call("space_remove", { path: RENAMED });
  if (existsSync(annotationFile(RENAMED))) fail("remove: annotation file left behind");
  ok("dropped with its file");
} finally {
  for (const path of [PATH, RENAMED]) {
    rmSync(join(SPACE, path), { force: true });
    rmSync(annotationFile(path), { force: true });
  }
  rmSync(inputDir, { recursive: true, force: true });
}
