// WHERE SHE READS EACH PROJECT SHE SERVES (spec local 2026-11-06-asistente-propio, §8, phase 4B). Claude Code has one
// «Primary working directory», where its shell runs, and «Additional working directories» its file tools also read.
// Hers: her home is the project's own folder, at /; every project she serves has a folder under
// ~/.assistant/projects/<id>, which Read, Glob and Grep read and nothing writes. `~` is /home/user, reserved in every
// project (`RESERVED_ROOTS` in lib/agent/ficheros/folder.ts), so the folder hides none of a project's files. By id: a
// title changes and an unpublished project has no address; PROJECTS.md and ask_len already name projects by it.
//
// Pure.
import { resolverRuta } from "@/lib/agent/ficheros/sitio";

/** MEASURED on 09/11 (phase 4B, task 4: real turns on a throwaway base through Len's route with a phone key, DeepSeek
 *  V4.1 Flash, the terminal without the box; Lucía serving «Pastelería Canela» — her home — and «Canela Tienda», whose
 *  DRAFT has a /LEN.md and an unpublished /ofertas/): 107 centicredits in all ($0.0033), 7 over the 100 cap (the script
 *  checked the spend only before each turn). «¿Qué le dejé dicho a Len en la tienda?» — 82 (the first call of her
 *  prefix, ~19.5k tokens, uncached), 14.8 s: she read this folder's line in PROJECTS.md and went to it with the TERMINAL
 *  (`ls ~/.assistant/projects/`, `find …/<shop>`), which answered «No such file or directory»; she told the owner she
 *  has no access. «¿La tienda ya tiene la página de ofertas?» — 25, 21.7 s: `find /` in the terminal and `view_page` of
 *  the published address; «no la veo». Read, Glob and Grep were never tried: the terminal must see these folders too,
 *  as Claude Code's shell sees its additional working directories.
 *
 *  MEASURED AGAIN on 09/11 after phase 4C (her terminal sees them, read-only), the same base and turns, cap 150: 83
 *  centicredits ($0.0027). The first — 73, 14.4 s: `ls ~/.assistant/projects/`, Read of the shop's LEN.md, a `find` in
 *  its folder → the exact instruction («Envíos de martes a sábado; nunca prometas entrega el mismo día.»). The second —
 *  10, 7.8 s: `cat` of the shop's ofertas/index.html → «sí, existe», with its title and line, and that it isn't linked
 *  from the shop nor published (PROJECTS.md lists only the home page). */
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
