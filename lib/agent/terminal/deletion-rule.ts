// What the terminal can delete, and why not: one rule for `rm` (guardarLoDeLaTerminal) and for git,
// whose revert must not record a page as deleted when the terminal would refuse to delete it
// (spec local 2026-10-15-git-for-len). Pure.
import { isFolderPath } from "@/lib/agent/ficheros/folder";
import { MEMORY_INDEX, memoryLayerOf } from "@/lib/agent/ficheros/len-md";

/** A page (or any other file of the site that isn't the folder's) is removed by the person, in the editor. */
export const SITE_FILE_REFUSAL = "the terminal cannot delete files of the site (a page is removed by the user, in the editor).";

/** Why the terminal won't delete this file, or null if it can. */
export function deletionRefusal(path: string): string | null {
  const layer = memoryLayerOf(path);
  if (layer === "note") return null;
  if (layer !== null) return layer === "index" ? `${MEMORY_INDEX} is generated from the notes.` : "write it empty to clear it.";
  if (isFolderPath(path)) return null;
  return SITE_FILE_REFUSAL;
}
