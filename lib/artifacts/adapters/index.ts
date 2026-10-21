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
import {audioCapabilityAvailable} from "../capabilities";
import {openaiArtifactSpeechTransport} from "./audio/openai";
import {renderAudio} from "./audio/render";
import {motionManifest} from "./motion/manifest";

/** Builds the isolated renderer for one job. Production uses the offline
 * container (`containerArtifactRenderer`, Linux only); the Windows trial worker
 * injects one that reaches the same supervisor through the WSL bridge. */
export type IsolatedRendererFactory = (image: string, fencingToken: string, admit: () => Promise<void>) => ArtifactRender;

/** Loaded only by the standalone worker. The app only queues sealed jobs. */
export function createArtifactAdapters(env: Readonly<Record<string, string | undefined>>, isolatedRenderer: IsolatedRendererFactory = containerArtifactRenderer): Partial<Record<ArtifactKind, ArtifactAdapter>> {
  const adapters:Partial<Record<ArtifactKind,ArtifactAdapter>>={};
  if (env.OPENLEN_ARTIFACT_RENDERER_IMAGE) {
    const isolate=(run:(input:SealedArtifactInput,render:ArtifactRender,signal:AbortSignal)=>Promise<AdapterResult>):ArtifactAdapter=>async(input,signal,hooks)=>{
      if(!input.jobIdentity||!hooks.beforeIsolatedRender)throw new ArtifactError("renderer_admission_missing");
      return run(input,isolatedRenderer(env.OPENLEN_ARTIFACT_RENDERER_IMAGE!,input.jobIdentity.fencingToken,hooks.beforeIsolatedRender),signal);
    };
    adapters.dashboard=isolate(renderDashboard);
    adapters.slides=isolate(renderSlides);
    // Explicit spike gate until Linux resource/isolation acceptance passes.
    if(env.OPENLEN_ARTIFACT_MOTION_VERIFIED==="1")adapters.motion=isolate(async(input,render,signal)=>{
      if(motionManifest(input).audio&&env.OPENLEN_ARTIFACT_AUDIO_VERIFIED!=="1")throw new ArtifactError("audio_unavailable");
      return renderMotion(input,render,signal);
    });
    if(audioCapabilityAvailable(env)){
      const model=env.OPENLEN_ARTIFACT_AUDIO_MODEL??"gpt-4o-mini-tts-2025-12-15";
      const transport=openaiArtifactSpeechTransport({apiKey:env.OPENAI_API_KEY!,model});
      adapters.audio=async(input,signal,hooks)=>{
        // The platform belongs to the renderer: the container one refuses anything but Linux itself.
        if(!input.jobIdentity||!hooks.beforeIsolatedRender)throw new ArtifactError("renderer_admission_missing");
        return renderAudio(input,{transport,model},isolatedRenderer(env.OPENLEN_ARTIFACT_RENDERER_IMAGE!,input.jobIdentity.fencingToken,hooks.beforeIsolatedRender),signal,hooks);
      };
    }
  }
  if (env.OPENAI_API_KEY && artifactChargePolicy(env)) {
    const model=env.OPENLEN_ARTIFACT_IMAGE_MODEL??"gpt-image-2";
    const transport=openaiArtifactImageTransport({apiKey:env.OPENAI_API_KEY,model});
    adapters.image=(input,signal,hooks)=>generateArtifactImage(input,{transport,model},signal,hooks);
  }
  return adapters;
}
