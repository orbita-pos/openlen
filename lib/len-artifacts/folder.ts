// WHERE AN ARTIFACT LIVES (spec local 2026-11-22-artifacts-de-len, §3): Len's in `/.artifacts/<name>/` of the project, an
// agent's in `/.artifacts/<its slug>/<name>/` — the agents of one space share it, and their slugs keep them from writing over
// each other's. The dot keeps it out of the site (`classifyFolderPath` gives it its own kind). This is the ONE place the
// form is worked out from the turn: `publish_tool` reads it, and so does the guard of Write (`assistantMayWrite`).
//
// No imports beyond the folder rules: the file tools import it, and it must never pull the agent's runtime in.
import { ARTIFACTS_ROOT } from "@/lib/agent/ficheros/folder";

/** The part of a turn this needs: whose turn it is (an agent's, with its slug; or Len's, with none). */
export type ArtifactMakerOfTurn = { readonly assistant?: { readonly slug?: string } | undefined };

/** The folder this turn's maker keeps its artifacts in, with its trailing slash — Len's `/.artifacts/`, an agent's
 *  `/.artifacts/<its slug>/` — or null when an agent's turn doesn't say a slug that can be a folder name. */
export function artifactFolderOf(session: ArtifactMakerOfTurn): string | null {
  const agent = session.assistant;
  if (!agent) return `/${ARTIFACTS_ROOT}/`;
  const slug = agent.slug;
  if (!slug || slug === "." || slug === ".." || /[\\/]/.test(slug)) return null;
  return `/${ARTIFACTS_ROOT}/${slug}/`;
}
