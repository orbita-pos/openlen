import type { ArtifactKind } from "./types";
export const ARTIFACT_FORMATS: Readonly<Record<ArtifactKind, readonly string[]>> = {
  dashboard: ["html", "png", "csv"], slides: ["html", "pdf", "pptx"], image: ["png", "jpeg", "webp"], motion: ["html", "mp4"],
};
/** Filled by each verified adapter as it becomes available. A feature switch
 * alone must never advertise a renderer that this deployment cannot run. */
export function availableArtifactKinds(_env: Readonly<Record<string, string | undefined>> = process.env): ArtifactKind[] {
  return _env.OPENLEN_ARTIFACTS === "1" && _env.OPENLEN_ARTIFACT_RENDERER_IMAGE ? ["dashboard"] : [];
}
