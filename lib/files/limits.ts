// The «disk» of a project (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §4). Claude Code's only
// limits are the disk's; here OpenLen pays for the disk, so these are a generous one.

/** One file. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** The whole project: pages, folder, binaries and git's history, as a disk counts `.git`. */
export const MAX_PROJECT_BYTES = 1024 * 1024 * 1024;
export const MAX_PROJECT_FILES = 20_000;
export const MAX_PATH_CHARS = 1024;
export const MAX_PATH_DEPTH = 32;
/** Git objects this big or bigger live in R2, not in Postgres. */
export const LARGE_GIT_OBJECT_BYTES = 512 * 1024;

/** What comes back from the box only if the project's own .gitignore doesn't say otherwise: what a
 *  package manager or an interpreter regenerates. Git ignores it; here it never leaves the box. */
export const REGENERABLE_DEFAULTS: readonly string[] = ["node_modules/", ".venv/", "venv/", "__pycache__/", ".cache/"];
