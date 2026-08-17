import { describe, expect, it } from "vitest";

import { reconcileSectionManifest, sectionCount } from "./reconcile-section-manifest";
import {
  SECTION_COMPOSITION_MANIFEST_VERSION,
  SectionCompositionManifestSchema,
  hasOriginalSectionProvenance,
} from "@/lib/generation/section-composition-contracts";
import { sha256 } from "@/lib/generation/content-hash";

const H = (c: string) => `sha256:${c.repeat(64)}`;

const MANIFEST = {
  schemaVersion: SECTION_COMPOSITION_MANIFEST_VERSION,
  intentHash: H("a"), creativeDirectionHash: H("b"), inventoryHash: H("c"),
  orderedRoles: ["header", "hero", "features"],
  selectedSectionIds: ["nav-one", "hero-one", "features-one"],
  selectedContentHashes: ["a".repeat(12), "b".repeat(12), "c".repeat(12)],
  selectedSourceKinds: ["template_derived", "template_derived", "template_derived"],
  selectedSourceTemplateIds: ["donor-one", "donor-two", "donor-three"],
  selectedSourceBandOrdinals: [0, 1, 2],
  selectedStructuralFingerprints: [H("d"), H("e"), H("f")],
  compatibilityRuleIds: ["section_component:header", "section_component:hero", "section_component:features"],
  outputHash: null,
  resultCode: "composed" as const,
};

const page = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;
const band = (role: string, id: string, text = "x") =>
  `<section data-openlen-role="${role}" data-sec="${id}">${text}</section>`;
const ORIGINAL = page(band("header", "nav-one") + band("hero", "hero-one") + band("features", "features-one"));

/** Lo que la puerta de entrega comprueba, sin importar sus otras reglas. */
function rolesMatchDocument(manifest: typeof MANIFEST, html: string): boolean {
  const roles = [...html.matchAll(/data-openlen-role="([^"]+)"/g)].map((m) => m[1]);
  const ids = [...html.matchAll(/data-sec="([^"]+)"/g)].map((m) => m[1]);
  return roles.join("|") === manifest.orderedRoles.join("|")
    && ids.join("|") === manifest.selectedSectionIds.join("|");
}

describe("el manifiesto sigue al documento", () => {
  it("no toca nada cuando el documento es el que se compuso", () => {
    const next = reconcileSectionManifest(MANIFEST, ORIGINAL);
    expect(next.orderedRoles).toEqual(MANIFEST.orderedRoles);
    expect(next.selectedSectionIds).toEqual(MANIFEST.selectedSectionIds);
    expect(next.selectedSourceKinds).toEqual(MANIFEST.selectedSourceKinds);
  });

  it("una sección insertada entra como generada, no como robada a una plantilla", () => {
    const html = page(band("header", "nav-one") + band("hero", "hero-one")
      + band("gallery", "ol-gallery-4", "obra") + band("features", "features-one"));
    const next = reconcileSectionManifest(MANIFEST, html);
    expect(next.orderedRoles).toEqual(["header", "hero", "gallery", "features"]);
    expect(next.selectedSourceKinds).toEqual(["template_derived", "template_derived", "generated", "template_derived"]);
    expect(next.selectedSourceTemplateIds[2]).toBeNull();
    expect(next.selectedSourceBandOrdinals[2]).toBeNull();
    expect(next.selectedStructuralFingerprints[2]).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(rolesMatchDocument(next, html)).toBe(true);
  });

  it("una sección quitada desaparece del manifiesto", () => {
    const html = page(band("header", "nav-one") + band("features", "features-one"));
    const next = reconcileSectionManifest(MANIFEST, html);
    expect(next.orderedRoles).toEqual(["header", "features"]);
    expect(next.selectedSectionIds).toEqual(["nav-one", "features-one"]);
    expect(rolesMatchDocument(next, html)).toBe(true);
  });

  it("mover una sección conserva de dónde salió", () => {
    const html = page(band("hero", "hero-one") + band("header", "nav-one") + band("features", "features-one"));
    const next = reconcileSectionManifest(MANIFEST, html);
    expect(next.selectedSectionIds).toEqual(["hero-one", "nav-one", "features-one"]);
    // La procedencia viaja con la sección: es lo que prueba que la página no
    // clonó una plantilla entera.
    expect(next.selectedSourceTemplateIds).toEqual(["donor-two", "donor-one", "donor-three"]);
    expect(next.selectedContentHashes).toEqual([MANIFEST.selectedContentHashes[1], MANIFEST.selectedContentHashes[0], MANIFEST.selectedContentHashes[2]]);
  });

  it("el manifiesto reconstruido sigue siendo válido para su contrato", () => {
    const html = page(band("header", "nav-one") + band("hero", "hero-one")
      + band("gallery", "ol-gallery-4") + band("features", "features-one"));
    const next = reconcileSectionManifest(MANIFEST, html);
    const parsed = SectionCompositionManifestSchema.safeParse({ ...next, outputHash: sha256(html) });
    expect(parsed.success).toBe(true);
  });

  it("y sigue probando que la página no clonó una plantilla", () => {
    const html = page(band("header", "nav-one") + band("hero", "hero-one")
      + band("gallery", "ol-gallery-4") + band("features", "features-one"));
    const next = reconcileSectionManifest(MANIFEST, html);
    expect(hasOriginalSectionProvenance({
      contentHashes: next.selectedContentHashes,
      sourceKinds: next.selectedSourceKinds as never,
      sourceTemplateIds: next.selectedSourceTemplateIds,
      sourceBandOrdinals: next.selectedSourceBandOrdinals,
      structuralFingerprints: next.selectedStructuralFingerprints,
    })).toBe(true);
  });

  it("un manifiesto con columnas desalineadas se deja en paz", () => {
    const broken = { ...MANIFEST, orderedRoles: ["header"] };
    expect(reconcileSectionManifest(broken, ORIGINAL)).toBe(broken);
  });

  it("un documento sin secciones se deja en paz", () => {
    expect(reconcileSectionManifest(MANIFEST, "<html><body><p>nada</p></body></html>")).toBe(MANIFEST);
  });

  it("cuenta las secciones que la página lleva", () => {
    expect(sectionCount(ORIGINAL)).toBe(3);
    expect(sectionCount("<div>nada</div>")).toBe(0);
  });
});
