import { sha256 } from "@/lib/generation/content-hash";
import type { ProjectData, VisualEngineProjectMetadata } from "@/lib/projects/types";

/** Create with AI persists either a composed page or one the creative model
 *  authored end to end. Both carry a manifest whose output hash must match the
 *  bytes being written; nothing else about their shape is comparable. */
type CompositionMetadata = Extract<
  VisualEngineProjectMetadata,
  { route: "section_composition" | "creative_document" }
>;

export interface AiCompositionDocument {
  html: string;
  visualEngine: CompositionMetadata;
}

function requireCompositionMetadata(
  document: AiCompositionDocument,
): CompositionMetadata {
  const metadata = document.visualEngine as VisualEngineProjectMetadata | undefined;
  if (!metadata || metadata.templateId !== null) {
    throw new Error("Invalid AI composition document");
  }
  const outputHash = sha256(document.html);
  if (metadata.route === "section_composition") {
    if (
      metadata.compositionManifest.resultCode !== "composed"
      || metadata.compositionManifest.outputHash !== outputHash
    ) {
      throw new Error("Invalid AI composition document");
    }
    return metadata;
  }
  if (
    metadata.route !== "creative_document"
    || metadata.documentManifest.resultCode !== "authored"
    || metadata.documentManifest.outputHash !== outputHash
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
