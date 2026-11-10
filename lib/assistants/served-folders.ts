// WHERE SHE READS EACH PROJECT SHE SERVES (spec local 2026-11-06-asistente-propio, §8, phase 4B). Claude Code has one
// «Primary working directory», where its shell runs, and «Additional working directories» its file tools also read.
// Hers: her home is the project's own folder, at /; every project she serves has a folder under
// ~/.assistant/projects/<id>, which Read, Glob and Grep read and nothing writes. `~` is /home/user, reserved in every
// project (`RESERVED_ROOTS` in lib/agent/ficheros/folder.ts), so the folder hides none of a project's files. By id: a
// title changes and an unpublished project has no address; PROJECTS.md and ask_len already name projects by it.
//
// Pure.
import { resolverRuta } from "@/lib/agent/ficheros/sitio";

export const SERVED_FOLDERS = "~/.assistant/projects";

export function servedFolderOf(projectId: string): string {
  return `${SERVED_FOLDERS}/${projectId}`;
}

export type ServedFolderHit = { kind: "project"; projectId: string; prefix: string } | { kind: "parent" } | { kind: "unknown"; asked: string };

/** Where a path is among her projects' folders, or `null` when it isn't under them. */
export function servedFolderAt(path: string, served: readonly { id: string }[]): ServedFolderHit | null {
  const root = resolverRuta(SERVED_FOLDERS);
  const resolved = resolverRuta(path);
  if (resolved === root) return { kind: "parent" };
  if (!resolved.startsWith(`${root}/`)) return null;
  const id = resolved.slice(root.length + 1).split("/")[0]!;
  return served.some((p) => p.id === id) ? { kind: "project", projectId: id, prefix: `${root}/${id}` } : { kind: "unknown", asked: path };
}
