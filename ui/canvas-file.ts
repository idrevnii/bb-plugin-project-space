// What a canvas file on disk holds. tldraw puts a `user` record for the
// browser's own user into the document when an editor mounts; written out,
// every new browser (another bb window, the off-screen renderer, an e2e run)
// would rewrite the file just by opening it. So editors run without a current
// user, and saves drop `user` records, including ones older files picked up.
import { atom, serializeTldrawJson, type Editor, type TLUserStore } from "tldraw";

/** Pass as `users` to every <Tldraw> that may save. */
export const NO_USERS: TLUserStore = { currentUser: atom("no current user", null) };

/** The editor's document as a .tldr file, without `user` records. */
export async function serializeCanvas(editor: Editor): Promise<string> {
  const file = JSON.parse(await serializeTldrawJson(editor)) as {
    records?: { typeName?: string }[];
  };
  if (Array.isArray(file.records)) {
    file.records = file.records.filter((record) => record.typeName !== "user");
  }
  return JSON.stringify(file);
}
