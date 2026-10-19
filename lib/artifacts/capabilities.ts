import type { ArtifactKind } from "./types";
import { artifactChargePolicy } from "./billing";
export const ARTIFACT_FORMATS: Readonly<Record<ArtifactKind, readonly string[]>> = {
  dashboard: ["html", "png", "csv"], slides: ["html", "pdf", "pptx"], image: ["png", "jpeg", "webp"], motion: ["html", "mp4"], audio:["mp3","wav"],
};
/** Filled by each verified adapter as it becomes available. A feature switch
 * alone must never advertise a renderer that this deployment cannot run. */
export function availableArtifactKinds(_env: Readonly<Record<string, string | undefined>> = process.env): ArtifactKind[] {
  if (_env.OPENLEN_ARTIFACTS !== "1") return [];
  const kinds:ArtifactKind[]=_env.OPENLEN_ARTIFACT_RENDERER_IMAGE?["dashboard","slides"]:[];
  if(_env.OPENLEN_ARTIFACT_RENDERER_IMAGE&&_env.OPENLEN_ARTIFACT_MOTION_VERIFIED==="1")kinds.push("motion");
  if (_env.OPENAI_API_KEY && artifactChargePolicy(_env)) kinds.push("image");
  return kinds;
}
