import { sha256 } from "@/lib/generation/content-hash";
import type { ProjectData, VisualEngineProjectMetadata } from "@/lib/projects/types";

type CompositionMetadata = Extract<
  VisualEngineProjectMetadata,
  { route: "section_composition" }
>;

export interface AiCompositionDocument {
  html: string;
  visualEngine: CompositionMetadata;
}

function requireCompositionMetadata(
  document: AiCompositionDocument,
): CompositionMetadata {
  const metadata = document.visualEngine as VisualEngineProjectMetadata | undefined;
  if (
    !metadata
    || metadata.route !== "section_composition"
    || metadata.templateId !== null
    || metadata.compositionManifest.resultCode !== "composed"
    || metadata.compositionManifest.outputHash !== sha256(document.html)
  ) {
    throw new Error("Invalid AI composition document");
  }
  return metadata;
}

export async function commitAiCompositionDocument(
  document: AiCompositionDocument,
  deps: {
    persist(data: ProjectData): Promise<void>;
    emitPreview(html: string): void;
  },
): Promise<void> {
  const visualEngine = requireCompositionMetadata(document);
  const data: ProjectData = {
    html: document.html,
    generation: { visualEngine },
  };
  await deps.persist(data);
  deps.emitPreview(document.html);
}
