// Which paths of the box are the project's (spec local 2026-10-21-real-terminal-e2b, §5). The
// project lives at the box's root, as in today's terminal, so no path changes for the model; the
// person's memory lives at `HOME_DIR`, which is the box's HOME too. Everything else of the box —
// the system, /tmp, node_modules, the read-only /.openlen and the bridge's mailbox — never syncs.

import { HOME_DIR } from "@/lib/agent/ficheros/len-md";

/** Top-level folders that belong to the box's system, never to the project. */
export const SYSTEM_TOP_LEVEL: readonly string[] = [
  "bin", "boot", "dev", "etc", "home", "lib", "lib32", "lib64", "libx32", "media", "mnt", "opt", "proc", "root", "run",
  "sbin", "srv", "sys", "tmp", "usr", "var", "node_modules",
];

/** Visitor data: never in the box (Jesús, 21/10); Len reads it with its tools. */
export const NEVER_IN_BOX = /^\/\.openlen\/(bandeja|resultados)(\/|$)/;

const SYSTEM = new Set(SYSTEM_TOP_LEVEL);
const PERSONAL_MEMORY = `${HOME_DIR}/.len/`;

function topLevel(path: string): string {
  return path.split("/")[1] ?? "";
}

export function isSyncedPath(path: string): boolean {
  if (path.startsWith(PERSONAL_MEMORY)) return true;
  const top = topLevel(path);
  return top !== "" && top !== ".openlen" && !SYSTEM.has(top);
}

/** The project's paths that would land in a system folder of the box: any of them, and the turn uses today's terminal. */
export function conflictingTopLevel(projectPaths: readonly string[]): string[] {
  return projectPaths.filter((p) => !p.startsWith(PERSONAL_MEMORY) && SYSTEM.has(topLevel(p)));
}
