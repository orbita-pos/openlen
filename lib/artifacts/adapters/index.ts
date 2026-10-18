import type { ArtifactAdapter, ArtifactKind } from "../types";
import { containerArtifactRenderer } from "../render-container";
import { renderDashboard } from "./dashboard/render";
import { renderSlides } from "./slides/render";
import { openaiArtifactImageTransport } from "./image/openai";
import { generateArtifactImage } from "./image/render";
import { artifactChargePolicy } from "../billing";
import { renderMotion } from "./motion/render";

/** Loaded only by the standalone worker. The app only queues sealed jobs. */
export function createArtifactAdapters(env: Readonly<Record<string, string | undefined>>): Partial<Record<ArtifactKind, ArtifactAdapter>> {
  const adapters:Partial<Record<ArtifactKind,ArtifactAdapter>>={};
  if (env.OPENLEN_ARTIFACT_RENDERER_IMAGE) {
    const render = containerArtifactRenderer(env.OPENLEN_ARTIFACT_RENDERER_IMAGE);
    adapters.dashboard=(input,signal)=>renderDashboard(input,render,signal);
    adapters.slides=(input,signal)=>renderSlides(input,render,signal);
    // Explicit spike gate until Linux resource/isolation acceptance passes.
    if(env.OPENLEN_ARTIFACT_MOTION_VERIFIED==="1")adapters.motion=(input,signal)=>renderMotion(input,render,signal);
  }
  if (env.OPENAI_API_KEY && artifactChargePolicy(env)) {
    const model=env.OPENLEN_ARTIFACT_IMAGE_MODEL??"gpt-image-2";
    const transport=openaiArtifactImageTransport({apiKey:env.OPENAI_API_KEY,model});
    adapters.image=(input,signal,hooks)=>generateArtifactImage(input,{transport,model},signal,hooks);
  }
  return adapters;
}
