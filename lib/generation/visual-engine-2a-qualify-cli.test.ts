import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildSkeletonInventory } from "./skeleton-inventory";
import { canonicalJsonSha256 } from "./visual-engine-2a-eval";
import { VISUAL_ENGINE_2A_PILOT_CASES } from "./visual-engine-2a-cohort";
import type { SelectionCatalogTemplate } from "./visual-engine-2a-qualification";
import type { QualificationCliDependencies } from "@/scripts/visual-engine-2a-qualify";

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

async function runQualification(deps: QualificationCliDependencies, cwd = "workspace") {
  const { runVisualEngine2AQualification } = await import("@/scripts/visual-engine-2a-qualify");
  return runVisualEngine2AQualification(deps, cwd);
}

describe("Visual Engine 2A qualification CLI", () => {
  it("imports the injected runner without initializing the production store or emitting output", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("SKIP_DB_CHECK", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await import("@/scripts/visual-engine-2a-qualify");

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads the complete published catalog but fetches and writes only allowlisted material", async () => {
    const fixture = qualificationDependencies();
    fixture.deps.listTemplates = vi.fn(async () => [...selectionCatalog(), {
      id: "zzz-unallowlisted", status: "published" as const, visualMetadata: metadataFor(VISUAL_ENGINE_2A_PILOT_CASES[0]),
    }]);
    const cwd = join("workspace", "openlen");

    const manifest = await runQualification(fixture.deps, cwd);
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

    await expect(runQualification(fixture.deps))
      .rejects.toMatchObject({ code: "template_html_unavailable" });
    expect(fixture.logs).toHaveLength(1);
    expect(fixture.logs[0]).not.toContain(secret);
    expect(JSON.parse(fixture.logs[0])).toMatchObject({ event: "visual_engine_2a_qualification", ok: false, code: "template_html_unavailable" });
  });

  it("captures HEAD before external reads and rechecks it immediately before the atomic write", async () => {
    const fixture = qualificationDependencies();
    const order: string[] = [];
    let commitCalls = 0;
    fixture.deps.getCommitSha = vi.fn(async () => {
      commitCalls += 1;
      order.push(`head:${commitCalls}`);
      return "a".repeat(40);
    });
    fixture.deps.listTemplates = vi.fn(async () => { order.push("catalog"); return selectionCatalog(); });
    fixture.deps.getTemplateHtml = vi.fn(async (id) => { order.push(`html:${id}`); return HTML; });
    fixture.deps.mkdir = vi.fn(async () => { order.push("mkdir"); });
    fixture.deps.writeJsonAtomic = vi.fn(async (path, value) => { order.push("write"); fixture.writes.push({ path, value }); });

    await runQualification(fixture.deps);

    const firstHead = order.indexOf("head:1");
    const secondHead = order.indexOf("head:2");
    const lastHtml = Math.max(...order.map((entry, index) => entry.startsWith("html:") ? index : -1));
    expect(firstHead).toBe(0);
    expect(order.indexOf("catalog")).toBeGreaterThan(firstHead);
    expect(secondHead).toBeGreaterThan(lastHtml);
    expect(order.indexOf("write")).toBeGreaterThan(secondHead);
    expect(commitCalls).toBe(2);
  });

  it("refuses a changed HEAD without writing and emits one redacted aggregate record", async () => {
    const fixture = qualificationDependencies();
    const commits = ["a".repeat(40), "b".repeat(40)];
    fixture.deps.getCommitSha = vi.fn(async () => commits.shift()!);

    await expect(runQualification(fixture.deps)).rejects.toMatchObject({ code: "commit_changed" });
    expect(fixture.writes).toHaveLength(0);
    expect(fixture.logs).toHaveLength(1);
    expect(JSON.parse(fixture.logs[0])).toMatchObject({ event: "visual_engine_2a_qualification", ok: false, code: "commit_changed" });
  });
});
