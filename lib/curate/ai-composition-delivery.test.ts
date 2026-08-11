import { describe, expect, it } from "vitest";

import { CreativeDirectionSchema } from "@/lib/generation/creative-contracts";
import { COLORING_DIRECTION } from "@/lib/generation/creative-fixtures.test-support";
import { SectionCompositionManifestSchema } from "@/lib/generation/section-composition-contracts";
import { canonicalJsonSha256, sha256 } from "@/lib/generation/visual-engine-2a-eval";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";

import { sealAiCompositionOutput, validateAiCompositionDelivery } from "./ai-composition-delivery";

const direction = CreativeDirectionSchema.parse(COLORING_DIRECTION);
const HTML = [
  "<!doctype html>",
  "<html>",
  "<head><style data-openlen-visual-engine=\"creative-direction/1.0\">:root{--accent:#f06}</style></head>",
  "<body>",
  '<section data-sec="hero-coloring" data-openlen-role="hero"><h1>Mundo Pincel</h1></section>',
  '<section data-sec="gallery-coloring" data-openlen-role="coloring_gallery"><h2>Galeria</h2></section>',
  '<footer data-sec="footer-coloring" data-openlen-role="footer">Contacto</footer>',
  "</body>",
  "</html>",
].join("");

function visualEngine(html = HTML): Extract<VisualEngineProjectMetadata, { route: "section_composition" }> {
  return {
    schemaVersion: "visual-engine-project/1.0",
    route: "section_composition",
    templateId: null,
    creativeDirection: direction,
    promptVersion: "creative-prompt/1.0",
    policyVersion: "template-policy/1.0",
    contractVersion: "creative-direction/1.0",
    compositionManifest: SectionCompositionManifestSchema.parse({
      schemaVersion: "section-composition-manifest/1.0",
      intentHash: `sha256:${"a".repeat(64)}`,
      creativeDirectionHash: canonicalJsonSha256(direction),
      inventoryHash: `sha256:${"b".repeat(64)}`,
      orderedRoles: ["hero", "coloring_gallery", "footer"],
      selectedSectionIds: ["hero-coloring", "gallery-coloring", "footer-coloring"],
      selectedContentHashes: ["111111111111", "222222222222", "333333333333"],
      compatibilityRuleIds: [
        "section_component:hero>hero",
        "section_component:coloring_gallery>gallery",
        "section_component:footer>footer",
      ],
      outputHash: sha256(html),
      resultCode: "composed",
    }),
  };
}

function validate(html: string, metadata: unknown = visualEngine(), leaksAfter = 0) {
  return validateAiCompositionDelivery({ html, visualEngine: metadata, leaksAfter });
}

function assetPair() {
  const unsigned = {
    schemaVersion: "asset-manifest/1.0" as const,
    consistencyGroup: { id: "coloring-pack", mediaType: "illustration" as const, artDirection: "storybook", paletteHints: [], styleLock: "playful" },
    slots: [],
    fallbackPolicy: "fail_closed_on_required_identity_asset" as const,
  };
  const manifest = { ...unsigned, manifestId: canonicalJsonSha256(unsigned) };
  const trace = {
    schemaVersion: "asset-resolution-trace/1.0" as const,
    manifestId: manifest.manifestId,
    consistencyGroupCount: 1,
    curatedCount: 0,
    generatedCount: 0,
    abstractCount: 0,
    placeholderCount: 0,
    requiredUnresolvedCount: 0,
    rejectionCounts: {},
    provider: null,
    modelId: null,
    promptSha256: [],
    estimatedCostMicromxn: 0,
    durationMs: 1,
    resultCode: "resolved" as const,
  };
  return { manifest, trace };
}

describe("AI composition delivery", () => {
  it.each([
    ["template route", () => ({ ...visualEngine(), route: "template_skeleton" }), "invalid_composition_metadata"],
    ["template id", () => ({ ...visualEngine(), templateId: "lyceum" }), "invalid_composition_metadata"],
    ["manifest result", () => ({ ...visualEngine(), compositionManifest: { ...visualEngine().compositionManifest, resultCode: "internal_error" } }), "invalid_composition_manifest"],
    ["role order", () => ({ ...visualEngine(), compositionManifest: { ...visualEngine().compositionManifest, orderedRoles: ["footer", "coloring_gallery", "hero"] } }), "section_role_coverage_failed"],
    ["missing marker", () => visualEngine(), "creative_marker_invalid", HTML.replace(/<style data-openlen-visual-engine="creative-direction\/1\.0">[\s\S]*?<\/style>/, "")],
    ["changed html", () => visualEngine(), "output_hash_mismatch", `${HTML} `],
    ["one-sided assets", () => ({ ...visualEngine(), assetManifest: {} }), "asset_metadata_invalid"],
  ])("rejects %s", (_name, metadata, reasonCode, html = HTML) => {
    expect(validate(html, metadata())).toEqual({ ok: false, reasonCode });
  });

  it("accepts a valid sealed composition and returns parsed metadata", () => {
    const metadata = visualEngine();
    expect(validate(HTML, metadata)).toEqual({ ok: true, visualEngine: metadata });
  });

  it("seals the finalized bytes as a composed manifest", () => {
    const finalized = `${HTML}\n`;
    const sealed = sealAiCompositionOutput(visualEngine(), finalized);
    expect(sealed.compositionManifest).toMatchObject({
      resultCode: "composed",
      outputHash: sha256(finalized),
    });
  });

  it("requires accepted repair metadata to bind the delivered HTML hash", () => {
    const metadata = {
      ...visualEngine(),
      repair: {
        schemaVersion: "visual-repair-metadata/1.0" as const,
        accepted: true as const,
        promptVersion: "visual-repair-prompt/1.1",
        criticVersion: "visual-quality-verdict/2.1" as const,
        compilerVersion: "creative-direction/1.0" as const,
        issueCodesBefore: ["palette_mismatch" as const],
        issueCodesAfter: [],
        scoresBefore: { themeRecognition: 5, visualHierarchy: 7, componentCoherence: 7, mobileReadability: 8, imageryRelevance: 6, briefAdherence: 5 },
        scoresAfter: { themeRecognition: 7, visualHierarchy: 7, componentCoherence: 7, mobileReadability: 8, imageryRelevance: 7, briefAdherence: 7 },
        outputHashBefore: `sha256:${"f".repeat(64)}`,
        outputHashAfter: sha256(HTML),
      },
    };
    expect(validate(HTML, metadata)).toEqual({ ok: true, visualEngine: metadata });
    expect(validate(HTML, { ...metadata, repair: { ...metadata.repair, outputHashAfter: `sha256:${"e".repeat(64)}` } })).toEqual({
      ok: false,
      reasonCode: "output_hash_mismatch",
    });
  });

  it.each([
    ["creative direction hash", () => ({ ...visualEngine(), compositionManifest: { ...visualEngine().compositionManifest, creativeDirectionHash: `sha256:${"c".repeat(64)}` } }), "invalid_composition_manifest"],
    ["aligned manifest arrays", () => ({ ...visualEngine(), compositionManifest: { ...visualEngine().compositionManifest, selectedContentHashes: ["111111111111"] } }), "invalid_composition_manifest"],
    ["inherited copy leaks", () => visualEngine(), "section_role_coverage_failed", 1],
  ])("rejects invalid %s", (_name, metadata, reasonCode, leaksAfter = 0) => {
    expect(validate(HTML, metadata(), leaksAfter)).toEqual({ ok: false, reasonCode });
  });

  it.each([
    ["comment lookalike", HTML.replace(/<style data-openlen-visual-engine="creative-direction\/1\.0">[\s\S]*?<\/style>/, '<!-- data-openlen-visual-engine="creative-direction/1.0" -->')],
    ["text lookalike", HTML.replace(/<style data-openlen-visual-engine="creative-direction\/1\.0">[\s\S]*?<\/style>/, '<title>data-openlen-visual-engine="creative-direction/1.0"</title>')],
    ["wrong element", HTML.replace(/<style data-openlen-visual-engine="creative-direction\/1\.0">[\s\S]*?<\/style>/, '<div data-openlen-visual-engine="creative-direction/1.0"></div>')],
    ["duplicate marker", HTML.replace(/(<style data-openlen-visual-engine="creative-direction\/1\.0">[\s\S]*?<\/style>)/, "$1$1")],
  ])("requires exactly one real creative style marker: %s", (_name, html) => {
    expect(validate(html, visualEngine(html))).toEqual({ ok: false, reasonCode: "creative_marker_invalid" });
  });

  it.each([
    ["duplicate section IDs", HTML.replace('data-sec="gallery-coloring"', 'data-sec="hero-coloring"'), visualEngine()],
    [
      "fewer than three fragments",
      HTML.replace('<footer data-sec="footer-coloring" data-openlen-role="footer">Contacto</footer>', ""),
      { ...visualEngine(), compositionManifest: { ...visualEngine().compositionManifest, orderedRoles: ["hero", "coloring_gallery"], selectedSectionIds: ["hero-coloring", "gallery-coloring"], selectedContentHashes: ["111111111111", "222222222222"], compatibilityRuleIds: ["section_component:hero>hero", "section_component:coloring_gallery>gallery"] } },
    ],
    ["role mismatch", HTML.replace('data-openlen-role="coloring_gallery"', 'data-openlen-role="stories"'), visualEngine()],
    ["section mismatch", HTML.replace('data-sec="gallery-coloring"', 'data-sec="gallery-other"'), visualEngine()],
    [
      "relabeled full-page root",
      HTML.replace("<body>", '<body data-sec="hero-coloring" data-openlen-role="hero">')
        .replace('<section data-sec="hero-coloring" data-openlen-role="hero">', "<section>"),
      visualEngine(),
    ],
  ])("rejects section provenance failure: %s", (_name, html, metadata) => {
    expect(validate(html, { ...metadata, compositionManifest: { ...metadata.compositionManifest, outputHash: sha256(html) } })).toEqual({
      ok: false,
      reasonCode: "section_role_coverage_failed",
    });
  });

  it("rejects unique section IDs that alias the same verified fragment bytes", () => {
    const metadata = visualEngine();
    const aliased = {
      ...metadata,
      compositionManifest: {
        ...metadata.compositionManifest,
        selectedContentHashes: ["111111111111", "111111111111", "111111111111"],
        outputHash: sha256(HTML),
      },
    };
    expect(validate(HTML, aliased)).toEqual({
      ok: false,
      reasonCode: "section_role_coverage_failed",
    });
  });

  it("accepts a valid paired asset manifest and resolution trace", () => {
    const { manifest, trace } = assetPair();
    const metadata = { ...visualEngine(), assetManifest: manifest, assetTrace: trace };
    expect(validate(HTML, metadata)).toEqual({ ok: true, visualEngine: metadata });
  });

  it("rejects an asset manifest whose canonical hash is invalid", () => {
    const { manifest, trace } = assetPair();
    expect(validate(HTML, { ...visualEngine(), assetManifest: { ...manifest, manifestId: `sha256:${"d".repeat(64)}` }, assetTrace: trace })).toEqual({
      ok: false,
      reasonCode: "asset_metadata_invalid",
    });
  });

  it("rejects an asset trace whose manifest ID does not match", () => {
    const { manifest, trace } = assetPair();
    expect(validate(HTML, { ...visualEngine(), assetManifest: manifest, assetTrace: { ...trace, manifestId: `sha256:${"e".repeat(64)}` } })).toEqual({
      ok: false,
      reasonCode: "asset_metadata_invalid",
    });
  });
});
