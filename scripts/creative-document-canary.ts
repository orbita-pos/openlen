/**
 * Live Fireworks canary for whole-document creative generation.
 *
 * Everything else in this feature is verified against a mocked `fetch`, which
 * is the same evidence the previous architecture had before it failed on a real
 * call. This script is the only thing that talks to Fireworks, and it does the
 * cheap capability probe before the expensive page so a broken parameter costs
 * a fraction of a centavo instead of a full generation.
 *
 * It never touches the database, object storage, credits, or publishing.
 *
 *   npm run generation:creative-document:canary -- --live --max-mxn=1 --mode=transport
 *   npm run generation:creative-document:canary -- --live --max-mxn=1 --mode=page --brief="..."
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createFireworksDocumentClient } from "@/lib/ai/fireworks-document-client";
import { runCreativeDocument } from "@/lib/curate/creative-document";
import { buildDeterministicIntent, buildDeterministicPageCopy } from "@/lib/curate/deterministic-page-input";
import { sha256 } from "@/lib/generation/content-hash";
import { buildDeterministicCreativeDirection } from "@/lib/generation/deterministic-creative-direction";
import { FABLE_PRODUCTION_RATES } from "@/lib/generation/page-generation-budget";
import { createPageGenerationBudget } from "@/lib/generation/page-generation-budget";
import { modelIdForRole } from "@/lib/generation/fable-model-policy";
import type { BusinessProfileData } from "@/lib/business-profiles/types";

const MXN_PER_USD = 20;
const RATE = FABLE_PRODUCTION_RATES["accounts/fireworks/models/deepseek-v4-flash-0731"];
const DEFAULT_BRIEF = "Una plataforma infantil para colorear llamada \"Mundo Pincel\", con dibujos para imprimir y minijuegos";

interface Options {
  readonly live: boolean;
  readonly maxMxn: number;
  readonly mode: "transport" | "page";
  readonly brief: string;
  readonly skipRender: boolean;
  readonly out: string;
}

function parseOptions(argv: readonly string[]): Options {
  const flag = (name: string): string | undefined => argv.find((entry) => entry.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const mode = flag("mode") ?? "transport";
  if (mode !== "transport" && mode !== "page") throw new Error("--mode must be transport or page");
  const maxMxn = Number(flag("max-mxn") ?? "0");
  return {
    live: argv.includes("--live"),
    maxMxn,
    mode,
    brief: flag("brief") ?? DEFAULT_BRIEF,
    skipRender: argv.includes("--skip-render"),
    out: flag("out") ?? join("scratch", "creative-document"),
  };
}

/** Worst case for the reservation, in micro-MXN, from the production rate card. */
function estimateMicromxn(inputTokens: number, outputTokens: number): number {
  return Math.round(((inputTokens * RATE.input) + (outputTokens * RATE.output)) * MXN_PER_USD);
}

function mxn(micromxn: number): string {
  return `${(micromxn / 1_000_000).toFixed(4)} MXN (~$${(micromxn / 1_000_000 / MXN_PER_USD).toFixed(4)} USD)`;
}

function requireAuthorization(options: Options, estimate: number): void {
  if (!options.live) throw new Error("refusing to run without --live");
  if (!Number.isFinite(options.maxMxn) || options.maxMxn <= 0) throw new Error("--max-mxn must be a positive number of MXN");
  // The spend ceiling is checked before anything else that could fail for an
  // unrelated reason, so an over-budget run always reports why it stopped.
  const ceiling = Math.round(options.maxMxn * 1_000_000);
  if (estimate > ceiling) {
    throw new Error(`estimated ${mxn(estimate)} exceeds --max-mxn=${options.maxMxn}; aborting before any paid call`);
  }
  if (!process.env.FIREWORKS_API_KEY?.trim()) throw new Error("FIREWORKS_API_KEY is required");
}

/** The page budget contract fixes target/cap; --max-mxn is the operator's own
 *  ceiling, checked before the call rather than by the budget. */
function budget() {
  return createPageGenerationBudget({
    rateCardVersion: process.env.OPENLEN_FABLE_RATE_CARD_VERSION?.trim() || "canary",
    mxnPerUsd: MXN_PER_USD,
    targetMicromxn: 5_000_000,
    capMicromxn: 10_000_000,
  });
}

async function runTransportProbe(options: Options) {
  const maxOutputTokens = 600;
  const estimate = estimateMicromxn(400, maxOutputTokens);
  console.info(`[canary] mode=transport model=${modelIdForRole("reasoner")} estimate=${mxn(estimate)}`);
  requireAuthorization(options, estimate);

  const pageBudget = budget();
  const client = createFireworksDocumentClient({ budget: pageBudget });
  const started = Date.now();
  const result = await client.write({
    messages: [
      { role: "system", content: "You emit HTML documents and nothing else." },
      { role: "user", content: "Emit a minimal complete HTML document with the title Canary. First character <, last characters </html>." },
    ],
    maxOutputTokens,
    requestId: "creative-document-canary-transport",
  });

  return {
    mode: "transport" as const,
    ok: result.ok,
    modelId: result.modelId,
    code: result.ok ? null : result.code,
    providerCategory: result.ok ? null : result.providerCategory ?? null,
    httpStatus: result.ok ? null : result.httpStatus ?? null,
    usage: result.ok ? result.usage : result.usage ?? null,
    usageKnown: result.ok ? result.usageKnown : false,
    truncated: result.ok ? result.truncated : null,
    /** Shape only — the reply itself is never retained. */
    looksLikeDocument: result.ok ? /<html[\s>]/i.test(result.text) : null,
    replyBytes: result.ok ? result.text.length : 0,
    durationMs: Date.now() - started,
    cost: pageBudget.snapshot(),
    html: null as string | null,
  };
}

async function runPageProbe(options: Options) {
  const maxOutputTokens = 32_000;
  // The system prompt carries DESIGN_GUIDANCE; a repair turn re-sends the page.
  const estimate = estimateMicromxn(12_000, maxOutputTokens) * 2;
  console.info(`[canary] mode=page model=${modelIdForRole("reasoner")} estimate(worst case, both turns)=${mxn(estimate)}`);
  requireAuthorization(options, estimate);

  const pageBudget = budget();
  const client = createFireworksDocumentClient({ budget: pageBudget });
  const intent = buildDeterministicIntent(options.brief);
  const copy = buildDeterministicPageCopy(options.brief, intent);
  const profileData = {} as BusinessProfileData;
  const started = Date.now();

  const outcome = await runCreativeDocument({
    requestId: "creative-document-canary-page",
    brief: options.brief,
    title: copy.business_name ?? "OpenLen",
    profileData,
    creativeDirection: buildDeterministicCreativeDirection(intent).direction,
    intent,
  }, {
    client,
    ...(options.skipRender
      // A local Chrome problem must not be reported as a model problem.
      ? { render: async () => ({ desktop: { mimeType: "image/jpeg" as const, dataBase64: "" }, mobile: { mimeType: "image/jpeg" as const, dataBase64: "" } }) }
      : {}),
  });

  return {
    mode: "page" as const,
    ok: outcome.candidate !== null,
    modelId: modelIdForRole("reasoner"),
    stoppedBy: outcome.stoppedBy,
    providerCode: outcome.providerCode ?? null,
    turns: outcome.turns,
    rejections: outcome.rejections,
    title: outcome.candidate?.title ?? null,
    htmlBytes: outcome.candidate?.html.length ?? 0,
    outputHash: outcome.candidate ? sha256(outcome.candidate.html) : null,
    renderSkipped: options.skipRender,
    durationMs: Date.now() - started,
    cost: pageBudget.snapshot(),
    html: outcome.candidate?.html ?? null,
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseOptions(argv);
  const summary = options.mode === "transport" ? await runTransportProbe(options) : await runPageProbe(options);
  const { html, ...redacted } = summary;

  const runDirectory = join(options.out, `${summary.mode}-${sha256(String(summary.durationMs) + summary.modelId).slice(7, 19)}`);
  await mkdir(runDirectory, { recursive: true });
  await writeFile(join(runDirectory, "summary.json"), `${JSON.stringify(redacted, null, 2)}\n`, "utf8");
  // The document is the artefact a human has to look at; it stays out of the
  // redacted summary and out of git.
  if (html) await writeFile(join(runDirectory, "page.html"), html, "utf8");

  console.info(`[canary] ${summary.ok ? "OK" : "FAILED"} spent=${mxn(summary.cost.actualMicromxn)} evidence=${runDirectory}`);
  console.info(JSON.stringify(redacted, null, 2));
  return summary.ok ? 0 : 1;
}

/** Inert on import: only the CLI entry point may spend money. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error: unknown) => {
      console.error(`[canary] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
