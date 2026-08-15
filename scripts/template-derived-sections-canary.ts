import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJsonSha256 } from "@/lib/generation/content-hash";
import { TEMPLATE_DERIVED_NICHE_CASES } from "@/lib/generation/template-derived-niche-cohort";

export const TEMPLATE_DERIVED_CANARY_AUTHORIZATION = "AUTHORIZED_TEMPLATE_DERIVED_CANARY_ONCE";
const SAFE_RESULT_CODES = new Set(["composed", "intent_analysis_failed", "copy_generation_failed", "section_inventory_unavailable", "section_plan_failed", "section_fragment_unavailable", "composition_failed", "inherited_copy_leak", "creative_direction_failed", "asset_resolution_failed", "semantic_gate_failed", "visual_quality_failed", "unexpected_error", "invalid_usage"]);

export interface TemplateDerivedCanaryRow {
  caseId: string;
  ok: boolean;
  resultCode: string;
  costMicromxn: number;
  durationMs: number;
}
export interface TemplateDerivedCanaryReport {
  schemaVersion: "template-derived-canary/1.0";
  catalogManifestHash: string;
  rows: readonly TemplateDerivedCanaryRow[];
  counts: { expected: 6; attempted: number; passed: number; failed: number };
  totalCostMicromxn: number;
  reportSha256: string;
}
export interface TemplateDerivedCanaryDeps {
  live: boolean;
  authorization: string | undefined;
  creationMode: string | undefined;
  catalogManifestHash: string;
  expectedCatalogManifestHash: string;
  authoritativeHeadCurrent: boolean;
  dbAvailable: boolean;
  geminiKeyPresent: boolean;
  capMicromxn: number;
  reservedWorstCaseMicromxn: number;
  deterministicPreflight(caseId: string): Promise<boolean>;
  runCase(input: { caseId: string; brief: string }): Promise<{ ok: boolean; resultCode: string; costMicromxn: number; durationMs: number }>;
  recordTelemetry(row: TemplateDerivedCanaryRow): Promise<void>;
}
export type TemplateDerivedCanaryResult = { ok: true; report: TemplateDerivedCanaryReport } | { ok: false; code: "live_required" | "unauthorized" | "creation_disabled" | "catalog_stale" | "head_stale" | "db_unavailable" | "missing_key" | "invalid_budget" | "preflight_failed" | "budget_exceeded" | "case_failed"; report: TemplateDerivedCanaryReport };

function report(deps: TemplateDerivedCanaryDeps, rows: readonly TemplateDerivedCanaryRow[]): TemplateDerivedCanaryReport {
  const unsigned = { schemaVersion: "template-derived-canary/1.0" as const, catalogManifestHash: deps.catalogManifestHash, rows, counts: { expected: 6 as const, attempted: rows.length, passed: rows.filter((row) => row.ok).length, failed: 6 - rows.filter((row) => row.ok).length }, totalCostMicromxn: rows.reduce((sum, row) => sum + row.costMicromxn, 0) };
  return { ...unsigned, reportSha256: canonicalJsonSha256(unsigned) };
}

export async function runTemplateDerivedSectionsCanary(deps: TemplateDerivedCanaryDeps): Promise<TemplateDerivedCanaryResult> {
  const empty = () => report(deps, []);
  if (!deps.live) return { ok: false, code: "live_required", report: empty() };
  if (deps.authorization !== TEMPLATE_DERIVED_CANARY_AUTHORIZATION) return { ok: false, code: "unauthorized", report: empty() };
  if (deps.creationMode !== "enabled") return { ok: false, code: "creation_disabled", report: empty() };
  if (!/^sha256:[a-f0-9]{64}$/.test(deps.catalogManifestHash) || deps.catalogManifestHash !== deps.expectedCatalogManifestHash) return { ok: false, code: "catalog_stale", report: empty() };
  if (!deps.authoritativeHeadCurrent) return { ok: false, code: "head_stale", report: empty() };
  if (!deps.dbAvailable) return { ok: false, code: "db_unavailable", report: empty() };
  if (!deps.geminiKeyPresent) return { ok: false, code: "missing_key", report: empty() };
  if (!Number.isSafeInteger(deps.capMicromxn) || deps.capMicromxn <= 0 || !Number.isSafeInteger(deps.reservedWorstCaseMicromxn) || deps.reservedWorstCaseMicromxn <= 0) return { ok: false, code: "invalid_budget", report: empty() };
  const preflight = await Promise.all(TEMPLATE_DERIVED_NICHE_CASES.map((row) => deps.deterministicPreflight(row.id)));
  if (preflight.some((ok) => !ok)) return { ok: false, code: "preflight_failed", report: empty() };
  const rows: TemplateDerivedCanaryRow[] = [];
  for (const fixture of TEMPLATE_DERIVED_NICHE_CASES) {
    if (rows.reduce((sum, row) => sum + row.costMicromxn, 0) + deps.reservedWorstCaseMicromxn > deps.capMicromxn) return { ok: false, code: "budget_exceeded", report: report(deps, rows) };
    let outcome: Awaited<ReturnType<TemplateDerivedCanaryDeps["runCase"]>>;
    try { outcome = await deps.runCase({ caseId: fixture.id, brief: fixture.brief }); }
    catch { outcome = { ok: false, resultCode: "unexpected_error", costMicromxn: deps.reservedWorstCaseMicromxn, durationMs: 0 }; }
    const safeCost = Number.isSafeInteger(outcome.costMicromxn) && outcome.costMicromxn >= 0 ? outcome.costMicromxn : deps.reservedWorstCaseMicromxn;
    const safeCode = SAFE_RESULT_CODES.has(outcome.resultCode) ? outcome.resultCode : "unexpected_error";
    const row: TemplateDerivedCanaryRow = { caseId: fixture.id, ok: outcome.ok && safeCode === outcome.resultCode && safeCost === outcome.costMicromxn, resultCode: safeCost === outcome.costMicromxn ? safeCode : "invalid_usage", costMicromxn: safeCost, durationMs: Number.isSafeInteger(outcome.durationMs) && outcome.durationMs >= 0 ? outcome.durationMs : 0 };
    rows.push(row);
    try { await deps.recordTelemetry(row); }
    catch { return { ok: false, code: "case_failed", report: report(deps, rows) }; }
  }
  const finalReport = report(deps, rows);
  return rows.every((row) => row.ok) ? { ok: true, report: finalReport } : { ok: false, code: "case_failed", report: finalReport };
}

export function parseTemplateDerivedCanaryArgs(argv: readonly string[]): boolean { if (argv.length !== 1 || argv[0] !== "--live") throw new Error("live_required"); return true; }

async function productionDeps(live: boolean): Promise<TemplateDerivedCanaryDeps> {
  const [{ sql }, { db }, { listSections }, { buildSectionCompositionInventory, resolveSectionPlan }, { runAiCreation }, { listTemplates }, { buildTemplateCorpus }, { coerceBusinessData }, { buildDeterministicIntent }, { buildDeterministicCreativeDirection }, { planSectionComposition }] = await Promise.all([
    import("drizzle-orm"), import("@/lib/db"), import("@/lib/sections/store"), import("@/lib/generation/section-inventory"), import("@/lib/curate/run-ai-creation"), import("@/lib/templates/store"), import("@/lib/generation/template-section-corpus"), import("@/lib/style-match/autofill/types"), import("@/lib/curate/deterministic-page-input"), import("@/lib/generation/deterministic-creative-direction"), import("@/lib/generation/section-plan"),
  ]);
  let records: Awaited<ReturnType<typeof listSections>> = [];
  let catalogManifestHash = "";
  let dbAvailable = false;
  try {
    records = await listSections({ status: "published" });
    catalogManifestHash = canonicalJsonSha256(records.filter((row) => row.provenance && row.derivedSemantics).map((row) => ({ id: row.id, contentHash: row.contentHash, provenance: row.provenance, semantics: row.derivedSemantics })).sort((a, b) => a.id.localeCompare(b.id)));
    buildSectionCompositionInventory(records); dbAvailable = true;
  } catch { /* represented by db_unavailable */ }
  const reservedWorstCaseMicromxn = Number(process.env.OPENLEN_TEMPLATE_DERIVED_CANARY_CASE_MAX_MICROMXN);
  const runId = crypto.randomUUID();
  let authoritativeHeadCurrent = false;
  try {
    const corpus = await buildTemplateCorpus(await listTemplates({ status: "published" }), { fetchText: async (url) => {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      return response.ok ? response.text() : null;
    } });
    authoritativeHeadCurrent = corpus.manifestHash === process.env.OPENLEN_TEMPLATE_DERIVED_CORPUS_SHA256;
  } catch { /* represented by head_stale */ }
  return {
    live, authorization: process.env.OPENLEN_TEMPLATE_DERIVED_CANARY_AUTHORIZATION,
    creationMode: process.env.OPENLEN_AI_CREATION,
    catalogManifestHash, expectedCatalogManifestHash: process.env.OPENLEN_TEMPLATE_DERIVED_CATALOG_SHA256 ?? "",
    authoritativeHeadCurrent,
    dbAvailable, geminiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
    capMicromxn: Number(process.env.OPENLEN_TEMPLATE_DERIVED_CANARY_MAX_MICROMXN), reservedWorstCaseMicromxn,
    deterministicPreflight: async (caseId) => {
      const fixture = TEMPLATE_DERIVED_NICHE_CASES.find((row) => row.id === caseId); if (!fixture) return false;
      const intent = buildDeterministicIntent(fixture.brief); const inventory = buildSectionCompositionInventory(records);
      const planned = planSectionComposition({ intent, intentHash: canonicalJsonSha256(intent), inventoryHash: inventory.hash, availableTypes: new Set(inventory.entries.filter((entry) => !entry.needsJs).map((entry) => entry.type)) });
      if (!planned.ok) return false;
      try { resolveSectionPlan(planned.plan, inventory, { intent, direction: buildDeterministicCreativeDirection(intent).direction }); return true; }
      catch { return false; }
    },
    runCase: async ({ brief }) => {
      const started = Date.now();
      const profile = coerceBusinessData({ business_name: "Synthetic canary", pitch: brief, tagline_es: brief, cta_primary: "Explorar", language_detected: "es" });
      const result = await runAiCreation({ projectId: crypto.randomUUID(), brief, profileData: { ...profile, brand: null, photos: [], links: [] } }, { listSections: async () => records });
      return { ok: result.ok, resultCode: result.ok ? "composed" : result.reasonCode, costMicromxn: reservedWorstCaseMicromxn, durationMs: Math.max(0, Date.now() - started) };
    },
    recordTelemetry: async (row) => { await db.execute(sql`INSERT INTO "templateDerivedCanaryRuns" ("id", "runId", "caseId", "ok", "resultCode", "costMicromxn", "durationMs") VALUES (${crypto.randomUUID()}, ${runId}, ${row.caseId}, ${row.ok}, ${row.resultCode}, ${row.costMicromxn}, ${row.durationMs})`); },
  };
}

async function main(): Promise<void> {
  const live = parseTemplateDerivedCanaryArgs(process.argv.slice(2));
  if (process.env.OPENLEN_TEMPLATE_DERIVED_CANARY_AUTHORIZATION !== TEMPLATE_DERIVED_CANARY_AUTHORIZATION) {
    console.error(JSON.stringify({ event: "template_derived_canary", ok: false, code: "unauthorized" })); process.exitCode = 1; return;
  }
  const result = await runTemplateDerivedSectionsCanary(await productionDeps(live));
  const output = join(process.cwd(), "scratch", "visual-engine-derived-sections", "canary-report.json");
  await mkdir(dirname(output), { recursive: true });
  const { writeJsonAtomic } = await import("@/lib/fs/write-json-atomic");
  await writeJsonAtomic(output, result.report);
  console.log(JSON.stringify(result.ok ? { event: "template_derived_canary", ok: true, counts: result.report.counts, totalCostMicromxn: result.report.totalCostMicromxn, reportSha256: result.report.reportSha256 } : { event: "template_derived_canary", ok: false, code: result.code, counts: result.report.counts, totalCostMicromxn: result.report.totalCostMicromxn }));
  if (!result.ok) process.exitCode = 1;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch(() => { console.error(JSON.stringify({ event: "template_derived_canary", ok: false, code: "canary_failed" })); process.exitCode = 1; });
