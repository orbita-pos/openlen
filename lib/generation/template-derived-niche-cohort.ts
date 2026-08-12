import { hasOriginalSectionProvenance, type SectionCompositionManifest } from "./section-composition-contracts";

export interface TemplateDerivedNicheCase {
  id: "kids-coloring" | "horror-experience" | "school-community" | "cooking-editorial" | "boutique-hotel" | "physical-product";
  brief: string;
  requiredRoles: readonly string[];
  positiveSemanticFamilies: readonly string[];
  forbiddenSignals: readonly string[];
  requiredAssetMedia: readonly ("photo" | "illustration" | "texture")[];
}

export const TEMPLATE_DERIVED_NICHE_CASES: readonly TemplateDerivedNicheCase[] = Object.freeze([
  { id: "kids-coloring", brief: "Mundo Pincel, universo infantil de coloreo, cuentos, minijuegos y creatividad.", requiredRoles: ["header", "hero", "coloring_gallery", "minigames", "stories", "activities", "footer"], positiveSemanticFamilies: ["playful", "illustrated", "creator"], forbiddenSignals: ["dashboard", "course_ui", "game_ui"], requiredAssetMedia: ["illustration"] },
  { id: "horror-experience", brief: "Experiencia de terror atmosférica, narrativa y cinematográfica.", requiredRoles: ["header", "hero", "about", "gallery", "events", "call_to_action", "footer"], positiveSemanticFamilies: ["cinematic", "editorial"], forbiddenSignals: ["dashboard", "game_ui", "software_mockup"], requiredAssetMedia: ["photo", "texture"] },
  { id: "school-community", brief: "Escuela cálida para familias, programas, comunidad, eventos y contacto.", requiredRoles: ["header", "hero", "programs", "about", "events", "contact", "footer"], positiveSemanticFamilies: ["school", "community", "warm"], forbiddenSignals: ["dashboard", "course_ui"], requiredAssetMedia: ["photo"] },
  { id: "cooking-editorial", brief: "Publicación editorial de cocina, recetas e historias culinarias.", requiredRoles: ["header", "hero", "featured_content", "content_list", "newsletter", "footer"], positiveSemanticFamilies: ["editorial", "photographic", "tactile"], forbiddenSignals: ["dashboard", "commerce_grid"], requiredAssetMedia: ["photo"] },
  { id: "boutique-hotel", brief: "Hotel boutique sensorial con habitaciones, experiencias, galería y reservación.", requiredRoles: ["header", "hero", "about", "gallery", "services", "booking", "footer"], positiveSemanticFamilies: ["editorial", "photographic", "warm"], forbiddenSignals: ["dashboard", "software_mockup"], requiredAssetMedia: ["photo"] },
  { id: "physical-product", brief: "Venta de un producto físico con detalle, beneficios, reseñas y compra.", requiredRoles: ["header", "hero", "products", "features", "testimonials", "faq", "call_to_action", "footer"], positiveSemanticFamilies: ["product", "photographic", "tactile"], forbiddenSignals: ["dashboard", "software_mockup"], requiredAssetMedia: ["photo"] },
]);

export interface TemplateDerivedAcceptanceEvidence {
  manifest: SectionCompositionManifest;
  semanticFamilies: readonly string[];
  visibleText: string;
  resolvedAssetMedia: readonly string[];
  exactRoleMarkers: boolean;
  mobileOverflow: boolean;
  weakTypography: boolean;
  invalidGeometry: boolean;
}

export function evaluateTemplateDerivedNiche(caseRow: TemplateDerivedNicheCase, evidence: TemplateDerivedAcceptanceEvidence): boolean {
  const manifest = evidence.manifest;
  return manifest.resultCode === "composed"
    && caseRow.requiredRoles.length === manifest.orderedRoles.length
    && caseRow.requiredRoles.every((role, index) => role === manifest.orderedRoles[index])
    && caseRow.positiveSemanticFamilies.some((value) => evidence.semanticFamilies.includes(value))
    && caseRow.forbiddenSignals.every((value) => !evidence.semanticFamilies.includes(value) && !evidence.visibleText.toLowerCase().includes(value))
    && caseRow.requiredAssetMedia.every((value) => evidence.resolvedAssetMedia.includes(value))
    && evidence.exactRoleMarkers && !evidence.mobileOverflow && !evidence.weakTypography && !evidence.invalidGeometry
    && hasOriginalSectionProvenance({
      contentHashes: manifest.selectedContentHashes,
      sourceKinds: manifest.selectedSourceKinds,
      sourceTemplateIds: manifest.selectedSourceTemplateIds,
      sourceBandOrdinals: manifest.selectedSourceBandOrdinals,
      structuralFingerprints: manifest.selectedStructuralFingerprints,
    });
}
