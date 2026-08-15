import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { canonicalJsonSha256 } from "@/lib/generation/content-hash";
import { AI_HYBRID_NICHE_CASES } from "@/lib/generation/ai-hybrid-niche-cohort";

export const CREATIVE_SANDBOX_CANARY_AUTHORIZATION = "AUTHORIZED_CREATIVE_SANDBOX_CANARY_ONCE";

const PROVIDERS = ["deepseek-tool", "qwen-vision"] as const;
const COMMIT = /^[a-f0-9]{40}$/;

export type CreativeSandboxProvider = (typeof PROVIDERS)[number];

export type CreativeSandboxCanaryMode =
  | { readonly kind: "provider"; readonly provider: CreativeSandboxProvider }
  | { readonly kind: "page"; readonly caseId: string };

export interface CreativeSandboxCanaryArgs {
  readonly live: true;
  readonly mode: CreativeSandboxCanaryMode;
  readonly maxMicromxn: number;
  readonly commit: string;
}

export interface CreativeSandboxProbeOutcome {
  readonly ok: boolean;
  readonly resultCode: string;
  readonly modelId: string;
  readonly costMicromxn: number;
  readonly durationMs: number;
  readonly attempts: number;
  readonly providerCategory: string | null;
}

export interface CreativeSandboxPageOutcome extends CreativeSandboxProbeOutcome {
  readonly mutations: number;
  readonly images: number;
  /** Stages that failed without costing the page, as `stage:reason`. */
  readonly degradations?: readonly string[];
  readonly finalHash: string | null;
  readonly deterministic: {
    readonly mobileOverflow: boolean;
    readonly weakTypographyHierarchy: boolean;
    readonly invalidGeometry: boolean;
  };
}

export interface CreativeSandboxCanaryRow extends CreativeSandboxPageOutcome {
  readonly id: string;
}

export interface CreativeSandboxCanaryReport {
  readonly schemaVersion: "creative-sandbox-canary/1.0";
  readonly commit: string;
  readonly mode: string;
  readonly capMicromxn: number;
  readonly rows: readonly CreativeSandboxCanaryRow[];
  readonly totalCostMicromxn: number;
  readonly reportSha256: string;
}

export interface CreativeSandboxCanaryDeps {
  readonly authorization: string | undefined;
  readonly creationMode: string | undefined;
  readonly headCommit: string;
  readonly fireworksKeyPresent: boolean;
  /** The cap the page budget will actually enforce during the run. The
   * authorized cap has to cover it, or the spend is only bounded after the
   * money is gone. */
  readonly pageBudgetCapMicromxn: number;
  /** Which isolated probes have already passed. A page may not run first. */
  probeEvidence(): Promise<Record<CreativeSandboxProvider, boolean>>;
  runProbe(provider: CreativeSandboxProvider): Promise<CreativeSandboxProbeOutcome>;
  runPage(caseId: string): Promise<CreativeSandboxPageOutcome>;
  writeEvidence(report: CreativeSandboxCanaryReport): Promise<void>;
}

export type CreativeSandboxCanaryFailureCode =
  | "live_required"
  | "unauthorized"
  | "creation_disabled"
  | "commit_mismatch"
  | "missing_key"
  | "invalid_budget"
  | "probes_missing"
  | "budget_exceeded"
  | "probe_failed"
  | "page_failed";

export type CreativeSandboxCanaryResult =
  | { readonly ok: true; readonly report: CreativeSandboxCanaryReport }
  | { readonly ok: false; readonly code: CreativeSandboxCanaryFailureCode; readonly report: CreativeSandboxCanaryReport };

function positiveInteger(value: string | undefined): number | null {
  if (value === undefined || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const match = argv.find((entry) => entry.startsWith(`--${name}=`));
  return match?.slice(name.length + 3);
}

/** One mode, one cap, one commit, and `--live` spelled out. Anything else
 * throws before the process can reach a provider. */
export function parseCreativeSandboxCanaryArgs(argv: readonly string[]): CreativeSandboxCanaryArgs {
  if (!argv.includes("--live")) throw new Error("live_required");
  const provider = flag(argv, "provider");
  const caseId = flag(argv, "page");
  if ((provider === undefined) === (caseId === undefined)) throw new Error("mode_required");
  if (provider !== undefined && !PROVIDERS.includes(provider as CreativeSandboxProvider)) throw new Error("unknown_provider");
  if (caseId !== undefined && !AI_HYBRID_NICHE_CASES.some((row) => row.id === caseId)) throw new Error("unknown_case");

  const maxMicromxn = positiveInteger(flag(argv, "max-mxn"));
  if (maxMicromxn === null) throw new Error("invalid_budget");
  const commit = flag(argv, "commit");
  if (commit === undefined || !COMMIT.test(commit)) throw new Error("commit_required");

  return {
    live: true,
    mode: provider !== undefined
      ? { kind: "provider", provider: provider as CreativeSandboxProvider }
      : { kind: "page", caseId: caseId! },
    maxMicromxn,
    commit,
  };
}

function label(mode: CreativeSandboxCanaryMode): string {
  return mode.kind === "provider" ? `provider:${mode.provider}` : `page:${mode.caseId}`;
}

function safeCounter(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function row(id: string, outcome: CreativeSandboxProbeOutcome | CreativeSandboxPageOutcome): CreativeSandboxCanaryRow {
  const page = outcome as Partial<CreativeSandboxPageOutcome>;
  return {
    id,
    ok: outcome.ok === true,
    resultCode: outcome.resultCode,
    modelId: outcome.modelId,
    costMicromxn: safeCounter(outcome.costMicromxn),
    durationMs: safeCounter(outcome.durationMs),
    attempts: safeCounter(outcome.attempts),
    providerCategory: outcome.providerCategory ?? null,
    mutations: safeCounter(page.mutations ?? 0),
    images: safeCounter(page.images ?? 0),
    ...(page.degradations ? { degradations: [...page.degradations] } : {}),
    finalHash: page.finalHash ?? null,
    deterministic: page.deterministic ?? { mobileOverflow: false, weakTypographyHierarchy: false, invalidGeometry: false },
  };
}

function report(
  args: CreativeSandboxCanaryArgs,
  rows: readonly CreativeSandboxCanaryRow[],
): CreativeSandboxCanaryReport {
  const unsigned = {
    schemaVersion: "creative-sandbox-canary/1.0" as const,
    commit: args.commit,
    mode: label(args.mode),
    capMicromxn: args.maxMicromxn,
    rows,
    totalCostMicromxn: rows.reduce((total, entry) => total + entry.costMicromxn, 0),
  };
  return { ...unsigned, reportSha256: canonicalJsonSha256(unsigned) };
}

/**
 * One authorized unit of live work, once. Every gate is checked before the
 * first paid call, nothing is retried, and the evidence artifact carries
 * accounting only — never prompts, page bytes, screenshots or identities.
 */
export async function runCreativeSandboxCanary(
  args: CreativeSandboxCanaryArgs,
  deps: CreativeSandboxCanaryDeps,
): Promise<CreativeSandboxCanaryResult> {
  const empty = () => report(args, []);
  const fail = (code: CreativeSandboxCanaryFailureCode, rows: readonly CreativeSandboxCanaryRow[] = []) =>
    ({ ok: false as const, code, report: report(args, rows) });

  if (args.live !== true) return fail("live_required");
  if (deps.authorization !== CREATIVE_SANDBOX_CANARY_AUTHORIZATION) return fail("unauthorized");
  if (deps.creationMode !== "enabled") return fail("creation_disabled");
  if (!COMMIT.test(deps.headCommit) || deps.headCommit !== args.commit) return fail("commit_mismatch");
  if (!deps.fireworksKeyPresent) return fail("missing_key");
  if (!Number.isSafeInteger(args.maxMicromxn) || args.maxMicromxn <= 0) return fail("invalid_budget");
  const worstCase = deps.pageBudgetCapMicromxn;
  if (!Number.isSafeInteger(worstCase) || worstCase <= 0) return fail("invalid_budget");
  // The run's own budget is what actually stops spending; the authorization has
  // to be at least that large or it promises nothing.
  if (worstCase > args.maxMicromxn) return fail("budget_exceeded");

  if (args.mode.kind === "page") {
    let evidence: Record<CreativeSandboxProvider, boolean>;
    try { evidence = await deps.probeEvidence(); } catch { return fail("probes_missing"); }
    if (!PROVIDERS.every((provider) => evidence[provider] === true)) return fail("probes_missing");
  }

  const id = label(args.mode);
  let outcome: CreativeSandboxProbeOutcome | CreativeSandboxPageOutcome;
  try {
    outcome = args.mode.kind === "provider"
      ? await deps.runProbe(args.mode.provider)
      : await deps.runPage(args.mode.caseId);
  } catch {
    // A thrown boundary is one failed unit of work, never a second attempt.
    const failedRow = row(id, {
      ok: false, resultCode: "unexpected_error", modelId: "unknown",
      costMicromxn: worstCase, durationMs: 0, attempts: 1, providerCategory: null,
    });
    const failure = args.mode.kind === "provider" ? "probe_failed" as const : "page_failed" as const;
    const finalReport = report(args, [failedRow]);
    try { await deps.writeEvidence(finalReport); } catch { /* evidence is not the gate */ }
    return { ok: false, code: failure, report: finalReport };
  }

  const rows = [row(id, outcome)];
  const finalReport = report(args, rows);
  try { await deps.writeEvidence(finalReport); } catch { /* evidence is not the gate */ }

  if (finalReport.totalCostMicromxn > args.maxMicromxn) {
    return { ok: false, code: "budget_exceeded", report: finalReport };
  }
  if (!rows.every((entry) => entry.ok)) {
    return { ok: false, code: args.mode.kind === "provider" ? "probe_failed" : "page_failed", report: finalReport };
  }
  return { ok: true, report: finalReport };
}

async function productionDeps(): Promise<CreativeSandboxCanaryDeps> {
  const { readFile, writeFile } = await import("node:fs/promises");
  const evidenceDir = join(process.cwd(), "scratch", "creative-sandbox");
  const evidenceFile = join(evidenceDir, "probe-evidence.json");

  return {
    authorization: process.env.OPENLEN_CREATIVE_SANDBOX_CANARY_AUTHORIZATION,
    creationMode: process.env.OPENLEN_AI_CREATION,
    headCommit: process.env.OPENLEN_CREATIVE_SANDBOX_CANARY_COMMIT ?? "",
    fireworksKeyPresent: Boolean(process.env.FIREWORKS_API_KEY),
    pageBudgetCapMicromxn: Number(process.env.OPENLEN_FABLE_PAGE_CAP_MICROMXN),
    probeEvidence: async () => {
      try {
        const parsed = JSON.parse(await readFile(evidenceFile, "utf8")) as Record<string, boolean>;
        return { "deepseek-tool": parsed["deepseek-tool"] === true, "qwen-vision": parsed["qwen-vision"] === true };
      } catch {
        return { "deepseek-tool": false, "qwen-vision": false };
      }
    },
    runProbe: async (provider) => {
      const { runCreativeSandboxProbe } = await import("@/lib/curate/creative-sandbox-probe");
      return runCreativeSandboxProbe(provider);
    },
    runPage: async (caseId) => {
      const { runCreativeSandboxCanaryPage } = await import("@/lib/curate/creative-sandbox-probe");
      return runCreativeSandboxCanaryPage(caseId);
    },
    writeEvidence: async (finalReport) => {
      await mkdir(dirname(evidenceFile), { recursive: true });
      const runFile = join(evidenceDir, `${finalReport.reportSha256.replace("sha256:", "").slice(0, 16)}.json`);
      await mkdir(dirname(runFile), { recursive: true });
      await writeFile(runFile, JSON.stringify(finalReport, null, 2), "utf8");
      if (finalReport.mode.startsWith("provider:") && finalReport.rows.every((entry) => entry.ok)) {
        const provider = finalReport.mode.slice("provider:".length);
        let existing: Record<string, boolean> = {};
        try { existing = JSON.parse(await readFile(evidenceFile, "utf8")) as Record<string, boolean>; } catch { /* first probe */ }
        await writeFile(evidenceFile, JSON.stringify({ ...existing, [provider]: true }, null, 2), "utf8");
      }
    },
  };
}

async function main(): Promise<void> {
  let args: CreativeSandboxCanaryArgs;
  try {
    args = parseCreativeSandboxCanaryArgs(process.argv.slice(2));
  } catch (error) {
    console.error(JSON.stringify({ event: "creative_sandbox_canary", ok: false, code: (error as Error).message }));
    process.exitCode = 1;
    return;
  }
  const result = await runCreativeSandboxCanary(args, await productionDeps());
  console.log(JSON.stringify(result.ok
    ? { event: "creative_sandbox_canary", ok: true, mode: result.report.mode, totalCostMicromxn: result.report.totalCostMicromxn, reportSha256: result.report.reportSha256 }
    : { event: "creative_sandbox_canary", ok: false, code: result.code, mode: result.report.mode, totalCostMicromxn: result.report.totalCostMicromxn }));
  if (!result.ok) process.exitCode = 1;
}

// Importing this module must never run anything.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    console.error(JSON.stringify({ event: "creative_sandbox_canary", ok: false, code: "canary_failed" }));
    process.exitCode = 1;
  });
}
