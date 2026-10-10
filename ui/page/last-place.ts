// Where the user was: the last project and, per project, the last page. The
// ways into the space (the Space item, the thread header button, the project
// switcher and picker) open that page, not the start page.
import { normalizeSpacePath } from "../../lib/space";

const LAST_PROJECT_KEY = "project-space:last-project";
const LAST_PAGE_KEY = "project-space:last-page:";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the space then opens its start page.
  }
}

export function lastProject(): string | null {
  return read(LAST_PROJECT_KEY);
}

export function rememberProject(projectId: string) {
  write(LAST_PROJECT_KEY, projectId);
}

export function forgetProject() {
  write(LAST_PROJECT_KEY, null);
}

/** The last page of the project that opened, or "" for the start page. */
export function lastPage(projectId: string): string {
  return normalizeSpacePath(read(LAST_PAGE_KEY + projectId) ?? "") ?? "";
}

export function rememberPage(projectId: string, path: string) {
  write(LAST_PAGE_KEY + projectId, path);
}

/** Forgets `path` if it is the remembered page, for example after a delete. */
export function forgetPage(projectId: string, path: string) {
  if (read(LAST_PAGE_KEY + projectId) === path) write(LAST_PAGE_KEY + projectId, null);
}
