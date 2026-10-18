import type { ArtifactAdapter, ArtifactKind } from "../types";
import { containerArtifactRenderer } from "../render-container";
import { renderDashboard } from "./dashboard/render";
import { renderSlides } from "./slides/render";
import { openaiArtifactImageTransport } from "./image/openai";
import { generateArtifactImage } from "./image/render";
import { artifactChargePolicy } from "../billing";
import { renderMotion } from "./motion/render";
import {ArtifactError,type SealedArtifactInput,type AdapterResult} from "../types";
import type {ArtifactRender} from "../render-protocol";

/** Loaded only by the standalone worker. The app only queues sealed jobs. */
export function createArtifactAdapters(env: Readonly<Record<string, string | undefined>>): Partial<Record<ArtifactKind, ArtifactAdapter>> {
  const adapters:Partial<Record<ArtifactKind,ArtifactAdapter>>={};
  if (env.OPENLEN_ARTIFACT_RENDERER_IMAGE) {
    const isolate=(run:(input:SealedArtifactInput,render:ArtifactRender,signal:AbortSignal)=>Promise<AdapterResult>):ArtifactAdapter=>async(input,signal,hooks)=>{
      if(!input.jobIdentity||!hooks.beforeIsolatedRender)throw new ArtifactError("renderer_admission_missing");
      return run(input,containerArtifactRenderer(env.OPENLEN_ARTIFACT_RENDERER_IMAGE!,input.jobIdentity.fencingToken,hooks.beforeIsolatedRender),signal);
    };
    adapters.dashboard=isolate(renderDashboard);
    adapters.slides=isolate(renderSlides);
    // Explicit spike gate until Linux resource/isolation acceptance passes.
    if(env.OPENLEN_ARTIFACT_MOTION_VERIFIED==="1")adapters.motion=isolate(renderMotion);
  }
  if (env.OPENAI_API_KEY && artifactChargePolicy(env)) {
    const model=env.OPENLEN_ARTIFACT_IMAGE_MODEL??"gpt-image-2";
    const transport=openaiArtifactImageTransport({apiKey:env.OPENAI_API_KEY,model});
    adapters.image=(input,signal,hooks)=>generateArtifactImage(input,{transport,model},signal,hooks);
  }
  return adapters;
}
