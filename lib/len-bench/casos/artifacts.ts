import type { ArtifactKind } from "@/lib/artifacts/types";
/** Selection corpus for the real brain/recorder acceptance run. These are
 * prompts and expected observable tool effects, not scripted tool responses.
 * No model/provider call is made by importing this file. */
export const ARTIFACT_SELECTION_CASES: readonly {
  id: string;
  message: string;
  creates: Partial<Record<ArtifactKind, number>>;
  correction?: true;
}[] = [
  { id: "complete-request-es", message: "Mañana presento mi app: hazme una presentación, un video sin voz explicando qué hace, dos imágenes para promocionarla y un dashboard con el escenario de 100 clientes por mes.", creates: { slides: 1, motion: 1, image: 2, dashboard: 1 } },
  { id: "paraphrase-es", message: "Prepara el material para mostrar este proyecto: diapositivas, un clip explicativo sin narración, un par de imágenes publicitarias y un panel para simular 200 ventas.", creates: { slides: 1, motion: 1, image: 2, dashboard: 1 } },
  { id: "partial-images", message: "Crea dos imágenes promocionales distintas de esta app. Una para el lanzamiento y otra para sus funciones.", creates: { image: 2 } },
  { id: "scenario-dashboard", message: "Haz un dashboard para ver cómo se vería mi negocio con 50 ventas de 100 pesos al día. Es un escenario, no datos reales.", creates: { dashboard: 1 } },
  { id: "discussion-only", message: "¿Para qué serviría un video explicativo de mi app? Sólo explícame, todavía no hagas nada.", creates: {} },
  { id: "ordinary-app-edit", message: "Cambia el título del inicio por Mi nueva app y conserva todo lo demás.", creates: {} },
  { id: "existing-piece-correction", message: "En la presentación que ya hiciste, cambia sólo el título de la portada y usa la segunda imagen promocional. Conserva las demás diapositivas.", creates: {}, correction: true },
  { id: "unavailable-data", message: "Crea un panel de mis ventas reales. Si esta página no tiene datos, dime que faltan; no inventes cifras.", creates: { dashboard: 1 } },
];
