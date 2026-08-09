import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { runVisualEngine2CSmoke, validateVisualEngine2CSmokeGuard, type VisualEngine2CSmokeDeps } from "@/lib/generation/visual-engine-2c-eval";
import { buildEvidenceManifest, canonicalJsonSha256 } from "@/lib/generation/visual-engine-2a-eval";
import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import { verifyVisualEngine2CQualification, type VisualEngine2CQualificationManifest } from "@/lib/generation/visual-engine-2c-qualification";
import { visualEngine2CQualificationPath } from "./visual-engine-2c-qualify";

const execFileAsync = promisify(execFile);

export async function writeVisualEngine2CEvidence(root: string, args: {
  caseId: string; pilotRunId: string;
  baselineNormal: Uint8Array; baselineNeutral: Uint8Array;
  candidateNormal: Uint8Array; candidateNeutral: Uint8Array;
}): Promise<void> {
  const manifest = buildEvidenceManifest({ ...args, scenarioId: "visual-engine-2c-repair" });
  const directory = join(root, canonicalJsonSha256(manifest).slice("sha256:".length));
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "baselineNormal.jpg"), args.baselineNormal),
    writeFile(join(directory, "baselineNeutral.jpg"), args.baselineNeutral),
    writeFile(join(directory, "candidateNormal.jpg"), args.candidateNormal),
    writeFile(join(directory, "candidateNeutral.jpg"), args.candidateNeutral),
  ]);
  await writeJsonAtomic(join(directory, "manifest.json"), manifest);
}

type Env = Readonly<Record<string, string | undefined>>;
export interface VisualEngine2CEvalCliDeps extends Omit<VisualEngine2CSmokeDeps, "currentHead" | "currentQuota"> {
  env: Env; rateCardReady: boolean; getCommitSha(): Promise<string>;
  getQuota(): Promise<{ limit: number; used: number; existingRuns: number }>;
  readQualification(path: string): Promise<unknown>; log(line: string): void;
}
function budget(env: Env): number { const value = Number(env.OPENLEN_VISUAL_ENGINE_2C_PILOT_BUDGET_MICROMXN); return Number.isSafeInteger(value) ? value : 0; }
function manifest(value: unknown): VisualEngine2CQualificationManifest | null {
  return value && typeof value === "object" && !Array.isArray(value) && (value as { schemaVersion?: unknown }).schemaVersion === "visual-engine-2c-qualification/1.0" ? value as VisualEngine2CQualificationManifest : null;
}

export async function runVisualEngine2CEvalCli(deps: VisualEngine2CEvalCliDeps, cwd = process.cwd()) {
  try {
    const commitSha = await deps.getCommitSha(); const quota = await deps.getQuota();
    const saved = manifest(await deps.readQualification(visualEngine2CQualificationPath(cwd)));
    if (!saved || !verifyVisualEngine2CQualification(saved, { commitSha })) return { ok: false as const, code: "qualification_stale" };
    const guard = {
      mode: deps.env.OPENLEN_VISUAL_ENGINE_REPAIR,
      authorization: deps.env.OPENLEN_VISUAL_ENGINE_2C_AUTHORIZATION,
      commitSha, qualificationCommitSha: saved.commitSha, qualificationValid: true, quota,
      rateCardComplete: deps.rateCardReady, budgetMicromxn: budget(deps.env),
    };
    const checked = validateVisualEngine2CSmokeGuard(guard); if (!checked.ok) return checked;
    const result = await runVisualEngine2CSmoke(guard, { currentHead: deps.getCommitSha, currentQuota: deps.getQuota, reserve: deps.reserve, evaluate: deps.evaluate, complete: deps.complete });
    deps.log(JSON.stringify(result.ok ? { event: "visual_engine_2c_eval", ok: true, reservations: result.reservations, providerCalls: result.providerCalls, totalCostMicromxn: result.totalCostMicromxn } : { event: "visual_engine_2c_eval", ok: false, code: result.code }));
    return result;
  } catch { const result = { ok: false as const, code: "evaluation_failed" }; deps.log(JSON.stringify({ event: "visual_engine_2c_eval", ...result })); return result; }
}

function environmentShapeReady(env: Env): boolean {
  return env.OPENLEN_VISUAL_ENGINE_REPAIR === "shadow"
    && env.OPENLEN_VISUAL_ENGINE_2C_AUTHORIZATION === "AUTHORIZED_2C_SMOKE_ONCE"
    && budget(env) >= 1 && budget(env) <= 30_000_000;
}

async function gitHead(): Promise<string> { const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), shell: false }); return stdout.trim(); }

async function productionDeps(): Promise<VisualEngine2CEvalCliDeps> {
  const [{ sql }, { db }, store, cost, cohort, contracts, closed, renderer, critic, repair, apply] = await Promise.all([
    import("drizzle-orm"), import("@/lib/db"), import("@/lib/generation/visual-engine-pilot-store"),
    import("@/lib/generation/model-cost"), import("@/lib/generation/visual-engine-2c-cohort"),
    import("@/lib/generation/creative-contracts"), import("@/lib/generation/closed-loop-repair"),
    import("@/lib/ai/visual-quality-renderer"), import("@/lib/ai/visual-quality-critic"),
    import("@/lib/generation/generate-visual-repair"), import("@/lib/generation/apply-visual-repair"),
  ]);
  let rateCard: ReturnType<typeof cost.parsePilotRateCardFromEnv> | null = null;
  try { rateCard = cost.parsePilotRateCardFromEnv(process.env); } catch { /* gate remains closed */ }
  const quota = async () => {
    const raw = await db.execute(sql`SELECT "limit", "used", (SELECT COUNT(*) FROM "visualEnginePilotRuns" WHERE "phase" = '2c') AS "existingRuns" FROM "visualEnginePilotBudgets" WHERE "phase" = '2c'`);
    const rows = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : raw && typeof raw === "object" && "rows" in raw && Array.isArray(raw.rows) ? raw.rows as Array<Record<string, unknown>> : [];
    return { limit: Number(rows[0]?.limit), used: Number(rows[0]?.used), existingRuns: Number(rows[0]?.existingRuns) };
  };
  const visualTokens = (row: (typeof cohort.VISUAL_ENGINE_2C_CASES)[number]) => {
    const domain = row.intent.domains[0] ?? "creative";
    if (/developer|technical/.test(domain)) return { background: "#07111F", surface: "#0E1B2E", surfaceAlt: "#14243A", foreground: "#E8F2FF", foregroundMuted: "#AFC4DB", accent: "#38BDF8", accentInk: "#06121F", border: "#28425E" };
    if (/wellness|hospitality/.test(domain)) return { background: "#F5F3EA", surface: "#FFFFFF", surfaceAlt: "#E8EEE3", foreground: "#243129", foregroundMuted: "#637067", accent: "#6D8B74", accentInk: "#FFFFFF", border: "#CBD6C8" };
    if (/food/.test(domain)) return { background: "#FFF8ED", surface: "#FFFFFF", surfaceAlt: "#F8E6D0", foreground: "#3A2419", foregroundMuted: "#775D4F", accent: "#C75B39", accentInk: "#FFFFFF", border: "#EBC6AA" };
    return { background: "#FFF7FC", surface: "#FFFFFF", surfaceAlt: "#FCE7F3", foreground: "#31213A", foregroundMuted: "#6B5B73", accent: "#EC4899", accentInk: "#FFFFFF", border: "#F5B8D3" };
  };
  const directionFor = (row: (typeof cohort.VISUAL_ENGINE_2C_CASES)[number]) => contracts.CreativeDirectionSchema.parse({
    schemaVersion: "creative-direction/1.0", mode: "cream", visualArchetype: "editorial_play",
    emotionalTone: row.intent.emotionalGoals, palette: visualTokens(row),
    typography: { display: "rounded_playful", body: "friendly_high_legibility", mono: null, scale: "expressive" },
    geometry: { radius: "extra_round", radiusScale: 1.75, spacingScale: 1.15, density: "low_medium" },
    imagery: { strategy: "illustration_first", artDirection: "editorial_play", subjects: row.intent.requiredVisualSignals, avoid: row.intent.forbiddenVisualSignals },
    iconography: { style: "rounded_outline", strokeWeight: "medium", cornerStyle: "round" },
    componentTreatment: { cards: "soft", buttons: "round", navigation: "friendly", sections: "pastel" }, requiredVisualSignals: row.intent.requiredVisualSignals, forbiddenVisualSignals: row.intent.forbiddenVisualSignals,
  });
  const html = (row: (typeof cohort.VISUAL_ENGINE_2C_CASES)[number]) => {
    const palette = visualTokens(row);
    const defect = row.class === "healthy_keep" ? ""
      : row.class === "nonrepairable_or_fallback" ? "main{display:none}body{background:#fff;color:#fff}"
      : row.issueCode === "palette_mismatch" ? ":root{--ol-bg:#111;--ol-surface:#222;--ol-fg:#777;--ol-accent:#555;--ol-border:#333}"
      : row.issueCode === "weak_typography_hierarchy" ? "h1,.card,button{font-size:12px;font-weight:400;line-height:1.1}"
      : row.issueCode === "spacing_density" ? "main,section,.card{padding:2px;margin:1px;gap:1px}"
      : row.issueCode === "mobile_overflow" ? "main{width:1400px;max-width:none}"
      : row.issueCode === "imagery_mismatch" ? ".card::before{content:'KPI 98% / quarterly revenue';display:block}"
      : "body{border-radius:0;background:#E8F0FF}.card,button{border-radius:0}";
    return `<!doctype html><html><head><style>:root{--ol-bg:${palette.background};--ol-surface:${palette.surface};--ol-fg:${palette.foreground};--ol-accent:${palette.accent};--ol-accent-ink:${palette.accentInk};--ol-border:${palette.border}}body{background:var(--ol-bg);color:var(--ol-fg);font-family:system-ui}main,section{padding:32px}.card{background:var(--ol-surface);border:1px solid var(--ol-border);border-radius:24px;padding:24px;margin:12px}button{background:var(--ol-accent);color:var(--ol-accent-ink);border-radius:999px;padding:12px 20px}${defect}</style></head><body><header data-openlen-role="header"><nav>${row.id}</nav></header><main><section data-openlen-role="hero"><h1>${row.intent.functional.siteType}</h1><button>Explore</button></section><section data-openlen-role="features"><div class="card">${row.intent.requiredVisualSignals[0] ?? "Distinctive experience"}</div><div class="card">${row.intent.requiredVisualSignals[1] ?? "Curated content"}</div></section></main><footer data-openlen-role="footer">OpenLen synthetic pilot</footer></body></html>`;
  };
  const evidenceRoot = join(process.cwd(), "scratch", "visual-engine-2c", "evidence");
  return {
    env: process.env, rateCardReady: rateCard !== null, getCommitSha: gitHead, getQuota: quota,
    readQualification: async (path) => JSON.parse(await readFile(path, "utf8")) as unknown,
    reserve: async (index) => {
      const row = cohort.VISUAL_ENGINE_2C_CASES[index]!;
      return store.reserveVisualEnginePilotRun({ phase: "2c", mode: "shadow", route: row.route, templateId: row.fixtureId });
    },
    evaluate: async (index, reservation, lease) => {
      if (!rateCard) throw new Error("rate_card_unavailable");
      const row = cohort.VISUAL_ENGINE_2C_CASES[index]!;
      const originalHtml = html(row);
      let providerCalls = 0;
      const consumeProviderCall = () => {
        if (providerCalls >= lease.providerCallCeiling) throw new Error("provider_call_ceiling_exhausted");
        providerCalls += 1;
      };
      const result = await closed.runClosedLoopVisualRepair({ html: originalHtml, metadata: {}, sourceId: row.fixtureId, intent: row.intent, direction: directionFor(row), route: row.route }, {
        render: (value) => renderer.renderVisualQualityViewports(value),
        critic: (request) => { consumeProviderCall(); return critic.critiqueVisualQuality({ ...request, model: process.env.OPENLEN_VISUAL_ENGINE_CRITIC_MODEL ?? "gemini-2.5-flash" }); },
        generatePlan: (request) => { consumeProviderCall(); return repair.generateVisualRepairPlan(request); },
        applyPlan: (request) => apply.applyVisualRepairPlan(request),
      });
      const usages = result.trace.usage;
      const actualCost = usages.reduce((sum, usage) => sum + cost.calculateModelCostMicros({ intent: usage }, rateCard!, rateCard!.mxnPerUsd).observedPilotCostMicromxn, 0);
      const costMicromxn = usages.length === providerCalls ? actualCost : Math.max(actualCost, lease.costMicromxnCeiling);
      if (result.accepted) {
        const [baseline, candidate] = await Promise.all([
          renderer.renderVisualQualityViewports(originalHtml),
          renderer.renderVisualQualityViewports(result.html),
        ]);
        if (!baseline || !candidate) return { providerCalls, costMicromxn, status: "failed" as const };
        await writeVisualEngine2CEvidence(evidenceRoot, {
          caseId: row.id, pilotRunId: reservation.id,
          baselineNormal: Buffer.from(baseline.desktop.dataBase64, "base64"),
          baselineNeutral: Buffer.from(baseline.mobile.dataBase64, "base64"),
          candidateNormal: Buffer.from(candidate.desktop.dataBase64, "base64"),
          candidateNeutral: Buffer.from(candidate.mobile.dataBase64, "base64"),
        });
      }
      return { providerCalls, costMicromxn, status: result.accepted || result.trace.resultCode === "healthy_keep" ? "adapted" as const : "fallback" as const };
    },
    complete: async (id, result) => store.completeVisualEnginePilotRun(id, { status: result.status === "adapted" ? "adapted" : result.status === "failed" ? "failed" : "fallback", observedPilotCostMicromxn: result.costMicromxn, productionEquivalentCostMicromxn: result.costMicromxn, rateCardVersion: rateCard?.version, candidatePersisted: false }),
    log: (line) => console.log(line),
  };
}

async function main() {
  if (!environmentShapeReady(process.env)) {
    console.log(JSON.stringify({ event: "visual_engine_2c_eval", ok: false, code: "invalid_environment" })); process.exitCode = 1; return;
  }
  const result = await runVisualEngine2CEvalCli(await productionDeps());
  if (!result.ok) process.exitCode = 1;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch(() => { process.exitCode = 1; });
