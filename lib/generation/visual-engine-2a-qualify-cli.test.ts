import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildSkeletonInventory } from "./skeleton-inventory";
import { canonicalJsonSha256 } from "./visual-engine-2a-eval";
import { VISUAL_ENGINE_2A_PILOT_CASES } from "./visual-engine-2a-cohort";
import type { SelectionCatalogTemplate } from "./visual-engine-2a-qualification";
import {
  runVisualEngine2AQualification,
  type QualificationCliDependencies,
} from "@/scripts/visual-engine-2a-qualify";

const HTML = "<!doctype html><html><body><header><a class=\"cta\" href=\"#contact\">Start</a></header><main><section><h1>Template</h1></section><section><p>Details</p></section></main></body></html>";

function metadataFor(caseRow: typeof VISUAL_ENGINE_2A_PILOT_CASES[number]) {
  return {
    schemaVersion: "template-visual-metadata/1.0" as const,
    domains: [...caseRow.expectedIntent.domains],
    audiences: [caseRow.expectedIntent.audience.primary],
    ageRanges: [], emotionalRegisters: [], visualArchetypes: [], visualSignals: [], layoutTraits: [], requiredAssetTypes: [], negativeTags: [],
    supportedSiteTypes: [caseRow.expectedIntent.functional.siteType],
    supportedSectionRoles: [...caseRow.expectedIntent.functional.requiredSections],
    themeability: "high" as const, identityStrength: "high" as const, reviewStatus: "reviewed" as const,
  };
}

function selectionCatalog(): SelectionCatalogTemplate[] {
  return VISUAL_ENGINE_2A_PILOT_CASES.map((caseRow) => ({
    id: caseRow.allowedSkeletonTemplateIds[0], status: "published", visualMetadata: metadataFor(caseRow),
  }));
}

function qualificationDependencies(overrides: Partial<QualificationCliDependencies> = {}) {
  const fetchedIds: string[] = [];
  const writes: Array<{ path: string; value: unknown }> = [];
  const logs: string[] = [];
  const deps: QualificationCliDependencies = {
    listTemplates: vi.fn(async () => selectionCatalog()),
    getTemplateHtml: vi.fn(async (id) => { fetchedIds.push(id); return HTML; }),
    getCommitSha: vi.fn(async () => "a".repeat(40)),
    mkdir: vi.fn(async () => undefined),
    writeJsonAtomic: vi.fn(async (path, value) => { writes.push({ path, value }); }),
    log: (line) => logs.push(line),
    ...overrides,
  };
  return { deps, fetchedIds, writes, logs };
}

describe("Visual Engine 2A qualification CLI", () => {
  it("reads the complete published catalog but fetches and writes only allowlisted material", async () => {
    const fixture = qualificationDependencies();
    fixture.deps.listTemplates = vi.fn(async () => [...selectionCatalog(), {
      id: "zzz-unallowlisted", status: "published" as const, visualMetadata: metadataFor(VISUAL_ENGINE_2A_PILOT_CASES[0]),
    }]);
    const cwd = join("workspace", "openlen");

    const manifest = await runVisualEngine2AQualification(fixture.deps, cwd);
    const allowedIds = [...new Set(VISUAL_ENGINE_2A_PILOT_CASES.flatMap((caseRow) => caseRow.allowedSkeletonTemplateIds))].sort();

    expect(fixture.deps.listTemplates).toHaveBeenCalledWith({ status: "published" });
    expect([...fixture.fetchedIds].sort()).toEqual(allowedIds);
    expect(fixture.fetchedIds).not.toContain("zzz-unallowlisted");
    expect(fixture.writes).toHaveLength(1);
    expect(fixture.writes[0].path).toBe(join(cwd, "scratch", "visual-engine-2a", "qualification.json"));
    expect(fixture.writes[0].value).toEqual(manifest);
    expect(manifest.catalogSha256).toBe(canonicalJsonSha256(selectionCatalog().concat({
      id: "zzz-unallowlisted", status: "published" as const, visualMetadata: metadataFor(VISUAL_ENGINE_2A_PILOT_CASES[0]),
    }).sort((left, right) => left.id.localeCompare(right.id))));
    expect(manifest.templates[0].inventorySha256).toBe(canonicalJsonSha256(buildSkeletonInventory(HTML, manifest.templates[0].id)));
    expect(fixture.logs).toHaveLength(1);
    expect(JSON.parse(fixture.logs[0])).toMatchObject({ event: "visual_engine_2a_qualification", ok: true });
  });

  it("redacts dependency failures rather than logging raw HTML or environment secrets", async () => {
    const secret = "GEMINI_API_KEY=super-secret-value";
    const fixture = qualificationDependencies({
      getTemplateHtml: async () => { throw new Error(secret); },
    });

    await expect(runVisualEngine2AQualification(fixture.deps, "workspace"))
      .rejects.toMatchObject({ code: "template_html_unavailable" });
    expect(fixture.logs).toHaveLength(1);
    expect(fixture.logs[0]).not.toContain(secret);
    expect(JSON.parse(fixture.logs[0])).toMatchObject({ event: "visual_engine_2a_qualification", ok: false, code: "template_html_unavailable" });
  });
});
