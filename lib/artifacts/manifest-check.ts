import { deckIndexIssue } from "./adapters/slides/deck";
import { motionManifestIssue } from "./adapters/motion/manifest";
import { audioManifestIssue } from "./adapters/audio/manifest";
import { NONE } from "./adapters/dashboard/manifest";

/**
 * A piece's manifest checked when it is saved, as a compiler answers a save: broken JSON at its line and column,
 * a wrong field by name, a retired format with what to write instead. What depends on the other files (the
 * entry, the slides, the datasets) is checked again on render_artifact, before anything is queued.
 */
export interface ManifestFinding { readonly line: number; readonly column: number; readonly message: string }

function position(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length, column: before.at(-1)!.length + 1 };
}

export function checkManifestSource(fileName: string, text: string): ManifestFinding[] {
  const name = fileName.split("/").pop()!;
  if (!["deck.json", "dashboard.json", "motion.json", "audio.json"].includes(name)) return [];
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    const at = /position (\d+)/.exec(message);
    return [{ ...(at ? position(text, Number(at[1])) : { line: 1, column: 1 }), message: `not valid JSON: ${message.replace(/ in JSON at position \d+.*$/, "")}` }];
  }
  let issue: string | null = null;
  if (name === "deck.json") issue = deckIndexIssue(raw);
  else if (name === "motion.json") issue = motionManifestIssue(raw);
  else if (name === "audio.json") issue = audioManifestIssue(raw);
  else {
    const m = raw as { entry?: unknown; datasetIds?: unknown };
    if (typeof m?.entry !== "string" || !m.entry.endsWith(".html")) issue = 'entry: the dashboard\'s .html file, e.g. "index.html"';
    else if (!Array.isArray(m.datasetIds) || !m.datasetIds.length) issue = NONE.replace(/^dashboard\.json /, "");
  }
  return issue ? [{ line: 1, column: 1, message: issue }] : [];
}
