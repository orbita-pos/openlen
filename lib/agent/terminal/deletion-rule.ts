// What the terminal can delete, and why not: one rule for `rm` (guardarLoDeLaTerminal) and for git,
// whose revert must not record a file as deleted when the terminal would refuse to delete it
// (spec local 2026-10-15-git-for-len). Pure.
import { isFolderPath } from "@/lib/agent/ficheros/folder";
import { MEMORY_INDEX, memoryLayerOf } from "@/lib/agent/ficheros/len-md";
import { paginaDeRuta } from "@/lib/agent/ficheros/sitio";
import { skillPathOf } from "@/lib/agent/skills/paths";

/** A file of the site that is neither a page nor the folder's (the project's settings, the platform's). */
export const SITE_FILE_REFUSAL = "the terminal cannot delete this file of the site.";

/** The home page: a site always has one (25/10: every other page can go, like `rm` in Claude Code). */
export const HOME_PAGE_REFUSAL = "the home page can't be removed: a site always has one. Write over it instead.";

/** Why the terminal won't delete this file, or null if it can. */
export function deletionRefusal(path: string): string | null {
  // A user skill goes like a memory note (spec local 2026-10-26-len-skills).
  if (skillPathOf(path)) return null;
  const layer = memoryLayerOf(path);
  if (layer === "note") return null;
  if (layer !== null) return layer === "index" ? `${MEMORY_INDEX} is generated from the notes.` : "write it empty to clear it.";
  if (isFolderPath(path)) return null;
  const page = paginaDeRuta(path);
  if (page) return page.page === null ? HOME_PAGE_REFUSAL : null;
  return SITE_FILE_REFUSAL;
}
