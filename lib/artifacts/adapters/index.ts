import type { ArtifactAdapter, ArtifactKind } from "../types";
import { containerArtifactRenderer } from "../render-container";
import { renderDashboard } from "./dashboard/render";
import { renderSlides } from "./slides/render";

/** Loaded only by the standalone worker. The app only queues sealed jobs. */
export function createArtifactAdapters(env: Readonly<Record<string, string | undefined>>): Partial<Record<ArtifactKind, ArtifactAdapter>> {
  if (!env.OPENLEN_ARTIFACT_RENDERER_IMAGE) return {};
  const render = containerArtifactRenderer(env.OPENLEN_ARTIFACT_RENDERER_IMAGE);
  return { dashboard: (input, signal) => renderDashboard(input, render, signal), slides: (input, signal) => renderSlides(input, render, signal) };
}
