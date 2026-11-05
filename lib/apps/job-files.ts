// A TOOL'S JOBS ARE NOT THE APP (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): the scripts in /jobs run in
// OpenLen's box with Node or Python, never in the browser. Like the tests, they are neither compiled nor checked with
// the app, nor bundled, nor served by its host (lib/tools/release.ts keeps them apart). Client-safe.

export const JOBS_FOLDER = "/jobs/";

export function isJobFile(ruta: string): boolean {
  return ruta.startsWith(JOBS_FOLDER);
}
