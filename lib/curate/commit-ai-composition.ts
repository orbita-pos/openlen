import { sha256 } from "@/lib/generation/content-hash";
import type { ProjectData, VisualEngineProjectMetadata } from "@/lib/projects/types";
import { applyModuleIntent } from "@/lib/projects/module-intent";

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
  // La otra mitad del puente: el hueco del módulo ya está en la página, y esto
  // enciende el flag que hace que el horneado de publicación lo cablee. Sin
  // esto la página lleva la banda y el módulo sigue apagado.
  const { settings, enabled } = applyModuleIntent(undefined, document.html);
  const data: ProjectData = {
    html: document.html,
    generation: { visualEngine },
    // Ausente cuando no hay nada que encender, que es como se guardaba antes.
    ...(enabled.length > 0 ? { settings } : {}),
  };
  await deps.persist(data);
  deps.emitPreview(document.html);
}
