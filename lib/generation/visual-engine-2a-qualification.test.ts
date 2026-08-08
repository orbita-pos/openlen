import { describe, expect, it } from "vitest";
import { buildSkeletonInventory } from "./skeleton-inventory";
import { decideGenerationRoute } from "./decide-route";
import {
  VISUAL_ENGINE_2A_DATASET_VERSION,
  VISUAL_ENGINE_2A_PILOT_CASES,
  type VisualEngine2APilotCase,
} from "./visual-engine-2a-cohort";
import {
  qualifyVisualEngine2ACohort,
  verifyVisualEngine2AQualification,
  type QualifiedCatalogTemplate,
} from "./visual-engine-2a-qualification";

const HTML = "<!doctype html><html><body><header><a class=\"cta\" href=\"#contact\">Start</a></header><main><section><h1>Template</h1></section><section><p>Details</p></section></main></body></html>";

function cloneCases(): VisualEngine2APilotCase[] {
  return structuredClone(VISUAL_ENGINE_2A_PILOT_CASES) as VisualEngine2APilotCase[];
}

function metadataFor(caseRow: VisualEngine2APilotCase) {
  return {
    schemaVersion: "template-visual-metadata/1.0" as const,
    domains: [...caseRow.expectedIntent.domains],
    audiences: [caseRow.expectedIntent.audience.primary],
    ageRanges: [],
    emotionalRegisters: [],
    visualArchetypes: [],
    visualSignals: [],
    layoutTraits: [],
    requiredAssetTypes: [],
    negativeTags: [],
    supportedSiteTypes: [caseRow.expectedIntent.functional.siteType],
    supportedSectionRoles: [...caseRow.expectedIntent.functional.requiredSections],
    themeability: "high" as const,
    identityStrength: "high" as const,
    reviewStatus: "reviewed" as const,
  };
}

function templatesFor(cases = VISUAL_ENGINE_2A_PILOT_CASES): QualifiedCatalogTemplate[] {
  return cases.map((caseRow) => {
    const id = caseRow.allowedSkeletonTemplateIds[0];
    return {
      id,
      status: "published" as const,
      visualMetadata: metadataFor(caseRow),
      html: HTML,
      inventory: buildSkeletonInventory(HTML, id),
    };
  });
}

function qualify(cases = cloneCases(), templates = templatesFor()) {
  return qualifyVisualEngine2ACohort({ cases, templates, commitSha: "a".repeat(40) });
}

describe("qualifyVisualEngine2ACohort", () => {
  it("qualifies the exact 15-case distribution without retaining prose in the manifest", () => {
    const result = qualify();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest).toMatchObject({
      schemaVersion: "visual-engine-2a-qualification/1.0",
      datasetVersion: VISUAL_ENGINE_2A_DATASET_VERSION,
      baseCaseCount: 15,
      expandedRowCount: 75,
      commitSha: "a".repeat(40),
    });
    expect(result.manifest.cases).toHaveLength(15);
    expect(result.manifest.templates).toHaveLength(15);
    expect(Object.keys(result.manifest.cases[0]).sort()).toEqual(["allowedTemplateIdsSha256", "caseId", "selectedTemplateId"]);
    expect(JSON.stringify(result.manifest)).not.toContain(VISUAL_ENGINE_2A_PILOT_CASES[0].brief);
    expect(qualifyVisualEngine2ACohort).toHaveLength(1);
  });

  it.each([
    ["duplicate IDs", (cases: VisualEngine2APilotCase[]) => { cases[1].id = cases[0].id; }],
    ["wrong dataset version", (cases: VisualEngine2APilotCase[]) => { (cases[0] as { datasetVersion: string }).datasetVersion = "other/1.0"; }],
    ["altered language distribution", (cases: VisualEngine2APilotCase[]) => { cases[0].language = "en"; cases[0].expectedIntent.language = "en"; }],
    ["empty allowlist", (cases: VisualEngine2APilotCase[]) => { cases[0].allowedSkeletonTemplateIds = []; }],
    ["duplicate allowlist", (cases: VisualEngine2APilotCase[]) => { cases[0].allowedSkeletonTemplateIds = ["rompiente", "rompiente"]; }],
  ])("rejects cohort source with %s", (_label, mutate) => {
    const cases = cloneCases();
    mutate(cases);
    expect(qualify(cases)).toEqual({ ok: false, code: "invalid_cases" });
  });

  it.each([
    ["brief", (caseRow: VisualEngine2APilotCase) => { caseRow.brief = "<script>bad()</script>"; }],
    ["content model", (caseRow: VisualEngine2APilotCase) => { caseRow.expectedIntent.functional.contentModel = "person@example.com"; }],
    ["constraint", (caseRow: VisualEngine2APilotCase) => { caseRow.expectedIntent.explicitConstraints = ["https://user:pass@example.com"]; }],
    ["ambiguity", (caseRow: VisualEngine2APilotCase) => { caseRow.expectedIntent.ambiguities = ["sk_live_abcdefghijklmnopqrstuvwxyz"]; }],
    ["structural pattern", (caseRow: VisualEngine2APilotCase) => { caseRow.identityConflict.structuralPattern = "-----BEGIN PRIVATE KEY-----"; }],
    ["baseline identity", (caseRow: VisualEngine2APilotCase) => { caseRow.identityConflict.baselineIdentity = "C:\\private\\template.html"; }],
    ["requested identity", (caseRow: VisualEngine2APilotCase) => { caseRow.identityConflict.requestedIdentity = "/private/template.html"; }],
    ["rationale", (caseRow: VisualEngine2APilotCase) => { caseRow.structuralRationale = "<main>markup</main>"; }],
    ["UNC path", (caseRow: VisualEngine2APilotCase) => { caseRow.expectedIntent.explicitConstraints = ["\\\\server\\share\\secret.txt"]; }],
    ["rooted Windows path", (caseRow: VisualEngine2APilotCase) => { caseRow.expectedIntent.ambiguities = ["\\Users\\secret.txt"]; }],
    ["drive-rooted Windows file", (caseRow: VisualEngine2APilotCase) => { caseRow.expectedIntent.explicitConstraints = ["C:\\secret.txt"]; }],
    ["single-rooted Windows file", (caseRow: VisualEngine2APilotCase) => { caseRow.expectedIntent.ambiguities = ["\\secret.txt"]; }],
    ["project API key", (caseRow: VisualEngine2APilotCase) => { caseRow.identityConflict.structuralPattern = "sk-proj-abcdefghijklmnopqrstuvwxyz"; }],
    ["AWS access key", (caseRow: VisualEngine2APilotCase) => { caseRow.identityConflict.baselineIdentity = "AKIAABCDEFGHIJKLMNOP"; }],
    ["GitHub token", (caseRow: VisualEngine2APilotCase) => { caseRow.identityConflict.requestedIdentity = "ghp_abcdefghijklmnopqrstuvwxyzABCDEFGH"; }],
  ])("rejects sensitive content in every prose-bearing field: %s", (_label, mutate) => {
    const cases = cloneCases();
    mutate(cases[0]);
    const result = qualify(cases);
    expect(result).toEqual({ ok: false, code: "unsafe_case_source" });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it.each([
    ["unpublished", (templates: QualifiedCatalogTemplate[]) => { templates[0].status = "draft"; }],
    ["unreviewed", (templates: QualifiedCatalogTemplate[]) => { templates[0].visualMetadata!.reviewStatus = "unreviewed"; }],
    ["non-high themeability", (templates: QualifiedCatalogTemplate[]) => { templates[0].visualMetadata!.themeability = "medium"; }],
    ["hard scoring filter", (templates: QualifiedCatalogTemplate[]) => { templates[0].visualMetadata!.negativeTags = ["education"]; }],
    ["full route", (templates: QualifiedCatalogTemplate[]) => { templates[0].visualMetadata!.emotionalRegisters = [...VISUAL_ENGINE_2A_PILOT_CASES[0].expectedIntent.emotionalGoals]; templates[0].visualMetadata!.visualSignals = [...VISUAL_ENGINE_2A_PILOT_CASES[0].expectedIntent.requiredVisualSignals]; }],
    ["structural fit below 0.75", (templates: QualifiedCatalogTemplate[]) => { templates[0].visualMetadata!.supportedSectionRoles = []; }],
    ["identity fit at or above 0.80", (templates: QualifiedCatalogTemplate[]) => { templates[0].visualMetadata!.emotionalRegisters = [...VISUAL_ENGINE_2A_PILOT_CASES[0].expectedIntent.emotionalGoals]; templates[0].visualMetadata!.visualSignals = [...VISUAL_ENGINE_2A_PILOT_CASES[0].expectedIntent.requiredVisualSignals]; }],
    ["adaptation cost above 0.60", (templates: QualifiedCatalogTemplate[]) => { templates[0].visualMetadata!.domains = []; }],
    ["invalid inventory", (templates: QualifiedCatalogTemplate[]) => { templates[0].inventory = { ...templates[0].inventory, templateId: "other" }; }],
  ])("fails deterministic qualification for %s", (_label, mutate) => {
    const templates = templatesFor();
    mutate(templates);
    expect(qualify(undefined, templates).ok).toBe(false);
  });

  it.each([
    ["missing", undefined],
    ["draft", (template: QualifiedCatalogTemplate) => { template.status = "draft"; }],
    ["unreviewed", (template: QualifiedCatalogTemplate) => { template.visualMetadata!.reviewStatus = "unreviewed"; }],
    ["non-high themeability", (template: QualifiedCatalogTemplate) => { template.visualMetadata!.themeability = "medium"; }],
    ["invalid inventory", (template: QualifiedCatalogTemplate) => { template.inventory = { ...template.inventory, templateId: "wrong-template" }; }],
  ])("rejects an additional %s allowlisted template even when the chosen template remains valid", (_label, mutate) => {
    const cases = cloneCases();
    const extraId = "additional-allowlisted";
    cases[0].allowedSkeletonTemplateIds = [cases[0].allowedSkeletonTemplateIds[0], extraId];
    const templates = templatesFor();
    if (mutate) {
      const extra: QualifiedCatalogTemplate = {
        id: extraId, status: "published", visualMetadata: metadataFor(cases[0]),
        html: HTML, inventory: buildSkeletonInventory(HTML, extraId),
      };
      mutate(extra);
      templates.push(extra);
    }
    expect(qualify(cases, templates)).toEqual({
      ok: false,
      code: mutate ? "invalid_allowlisted_template" : "missing_allowlisted_template",
    });
  });

  it("rejects a chosen route outside its case allowlist at qualification time", () => {
    const cases = cloneCases();
    cases[0].allowedSkeletonTemplateIds = [cases[1].allowedSkeletonTemplateIds[0]];
    expect(qualify(cases)).toEqual({ ok: false, code: "no_qualified_selection" });
  });

  it("uses the fixed production route boundaries without a qualification threshold override", () => {
    const candidate = {
      id: "boundary", eligible: true, structuralFit: 0.75, identityFit: 0.79,
      adaptationCost: 0.60, themeability: "high" as const, reasonCodes: [],
    };
    expect(decideGenerationRoute([candidate])).toMatchObject({ route: "template_skeleton", templateId: "boundary" });
    expect(decideGenerationRoute([{ ...candidate, structuralFit: 0.749999 }]).route).toBe("section_composition");
    expect(decideGenerationRoute([{ ...candidate, identityFit: 0.80 }])).toMatchObject({ route: "template_full", templateId: "boundary" });
    expect(decideGenerationRoute([{ ...candidate, adaptationCost: 0.600001 }]).route).toBe("section_composition");
  });

  it("requires at least ten selected templates and at most two base cases per selected template", () => {
    const cases = cloneCases();
    for (const caseRow of cases) caseRow.allowedSkeletonTemplateIds = ["shared"];
    const sharedMetadata = metadataFor(cases[0]);
    sharedMetadata.domains = [...new Set(cases.flatMap((caseRow) => caseRow.expectedIntent.domains))];
    sharedMetadata.audiences = [...new Set(cases.map((caseRow) => caseRow.expectedIntent.audience.primary))];
    sharedMetadata.supportedSiteTypes = [...new Set(cases.map((caseRow) => caseRow.expectedIntent.functional.siteType))];
    sharedMetadata.supportedSectionRoles = [...new Set(cases.flatMap((caseRow) => caseRow.expectedIntent.functional.requiredSections))];
    const shared = [{
      id: "shared", status: "published" as const, visualMetadata: sharedMetadata,
      html: HTML, inventory: buildSkeletonInventory(HTML, "shared"),
    }];
    expect(qualify(cases, shared)).toEqual({ ok: false, code: "insufficient_selected_templates" });

    const distributedCases = cloneCases();
    for (const caseRow of distributedCases.slice(0, 6)) caseRow.allowedSkeletonTemplateIds = ["shared"];
    const distributedTemplates = [
      ...shared,
      ...templatesFor(distributedCases.slice(6)),
    ];
    expect(qualify(distributedCases, distributedTemplates)).toEqual({ ok: false, code: "template_overrepresented" });
  });

  it("hashes canonical input by value and detects every material staleness dimension", () => {
    const result = qualify();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { manifest } = result;
    const current = { ...manifest };
    delete (current as Partial<typeof manifest>).manifestSha256;
    expect(verifyVisualEngine2AQualification({ manifest, current })).toEqual({ ok: true });
    for (const currentMutation of [
      { commitSha: "b".repeat(40) },
      { catalogSha256: `sha256:${"b".repeat(64)}` },
      { promptVersion: "intent-prompt/changed" },
      { policyVersion: "template-policy/changed" },
      { taxonomyVersion: "taxonomy-compatibility/changed" },
    ]) {
      expect(verifyVisualEngine2AQualification({ manifest, current: { ...current, ...currentMutation } as typeof current })).toEqual({ ok: false, code: "manifest_stale" });
    }

    const reordered = { datasetVersion: manifest.datasetVersion, schemaVersion: manifest.schemaVersion, cases: manifest.cases, templates: manifest.templates, datasetSha256: manifest.datasetSha256, catalogSha256: manifest.catalogSha256, commitSha: manifest.commitSha, promptVersion: manifest.promptVersion, policyVersion: manifest.policyVersion, taxonomyVersion: manifest.taxonomyVersion, baseCaseCount: manifest.baseCaseCount, expandedRowCount: manifest.expandedRowCount };
    expect(verifyVisualEngine2AQualification({ manifest: { ...reordered, manifestSha256: manifest.manifestSha256 }, current })).toEqual({ ok: true });

    const currentWithOnlyInventoryHashChanged = {
      ...current,
      templates: current.templates.map((template, index) => index === 0
        ? { ...template, inventorySha256: `sha256:${"c".repeat(64)}` }
        : template),
    };
    expect(verifyVisualEngine2AQualification({ manifest, current: currentWithOnlyInventoryHashChanged })).toEqual({ ok: false, code: "manifest_stale" });
  });

  it("changes manifest hashes for canonical cohort, metadata, HTML, inventory, and catalog membership", () => {
    const baseline = qualify();
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const changedHtml = HTML.replace("<section><p>Details</p></section>", "<section><p>Details</p></section><section><p>More</p></section>");
    const variants = [
      () => qualify(cloneCases().map((caseRow, index) => index === 0 ? { ...caseRow, brief: `${caseRow.brief}!` } : caseRow)),
      () => qualify(undefined, templatesFor().map((template, index) => index === 0 ? { ...template, visualMetadata: { ...template.visualMetadata!, layoutTraits: ["additional_trait"] } } : template)),
      () => qualify(undefined, templatesFor().map((template, index) => index === 0 ? { ...template, html: changedHtml, inventory: buildSkeletonInventory(changedHtml, template.id) } : template)),
      () => {
        const extraMetadata = metadataFor(VISUAL_ENGINE_2A_PILOT_CASES[0]);
        extraMetadata.domains = ["unrelated_domain"];
        extraMetadata.audiences = ["unrelated_audience"];
        extraMetadata.supportedSiteTypes = ["unrelated_site"];
        extraMetadata.supportedSectionRoles = ["unrelated_section"];
        return qualify(undefined, [...templatesFor(), {
          id: "zz-extra", status: "published" as const, visualMetadata: extraMetadata,
          html: HTML, inventory: buildSkeletonInventory(HTML, "zz-extra"),
        }]);
      },
    ];
    for (const variant of variants) {
      const result = variant();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.manifest.manifestSha256).not.toBe(baseline.manifest.manifestSha256);
    }
    expect(qualify(undefined, templatesFor().map((template, index) => index === 0 ? { ...template, status: "archived" } : template)).ok).toBe(false);
  });
});
