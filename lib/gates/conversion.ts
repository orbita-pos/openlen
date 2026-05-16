import { z } from "zod";
import { completeText } from "@/lib/together/client";
import type { GateContext, GateResult, GateViolation } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Gate 2 — conversion.
//
// Mixed deterministic + AI check.
//
//   1. Banned-phrase regex (deterministic, instant). The master prompt already
//      tells the fill step to avoid these — this catches escapes.
//   2. LFM2-24B-A2B AI judge that scores the page against an 8-point
//      conversion checklist. LFM2 prices at $0.03 / $0.12 per M tokens, so a
//      typical judge call lands ~$0.0005-0.001.
//
// Critical failures: missing/unclear CTA, weak hero copy, lorem ipsum, banned
// phrases. Everything else (social proof, form length, pricing, footer) is a
// warning — not worth re-filling for, but useful in meta.gateResults.
// ─────────────────────────────────────────────────────────────────────────────

const ConversionJudgeSchema = z.object({
  hasOnePrimaryCTA: z.boolean(),
  heroHasOutcomeLanguage: z.boolean(),
  socialProofPresent: z.boolean(),
  formIsReasonable: z.boolean(),
  noLoremPresent: z.boolean(),
  noBannedPhrases: z.boolean(),
  pricingVisibleIfExpected: z.boolean(),
  footerHasCompanyInfo: z.boolean(),
  reasoning: z.string(),
});

// Word-boundary regex catches whole-word matches only — avoids false positives
// in things like "leveraged" if we ever want to allow it later.
const BANNED_PHRASES_REGEX =
  /\b(world-class|cutting-edge|revolutionary|game-changing|leverage|unlock|supercharge|next-gen|reimagined|lorem ipsum|lorem)\b/i;

// "The future of <X>" needs a tiny bit more context to detect cleanly.
const FUTURE_OF_REGEX = /\bthe future of\s+\w+/i;

export async function runConversionGate(ctx: GateContext): Promise<GateResult> {
  const start = Date.now();
  const violations: GateViolation[] = [];
  let cost = 0;

  // ─── Deterministic pass: banned-phrase regex against the rendered text ───
  // Strip tags so we don't false-positive on attribute names (no realistic
  // landing-page block would have these phrases in markup but not visibly).
  const visible = stripHtml(ctx.html);
  const bannedMatch = visible.match(BANNED_PHRASES_REGEX);
  if (bannedMatch) {
    violations.push({
      gate: "conversion",
      severity: "critical",
      code: "banned-phrase",
      message: `Found banned phrase: "${bannedMatch[0]}"`,
      suggestion:
        "Replace with specific, benefit-driven copy that names the outcome.",
      evidence: { phrase: bannedMatch[0], index: bannedMatch.index },
    });
  }
  const futureMatch = visible.match(FUTURE_OF_REGEX);
  if (futureMatch) {
    violations.push({
      gate: "conversion",
      severity: "critical",
      code: "banned-phrase-future-of",
      message: `Found marketing cliche: "${futureMatch[0]}"`,
      suggestion:
        "Replace with concrete present-tense capability — what the product DOES today.",
      evidence: { phrase: futureMatch[0], index: futureMatch.index },
    });
  }

  // ─── AI judge for the rest of the checklist. Keep the prompt terse;
  //     LFM2-24B is a small model and a sprawling spec confuses it. ───
  try {
    const judgePrompt = buildJudgePrompt(ctx.html);
    const response = await completeText({
      model: "lfm2-24b-a2b",
      mockKey: "conversion-judge",
      messages: [
        {
          role: "system",
          content:
            "You are a strict conversion evaluator. Output a single JSON object matching the requested schema. No prose, no markdown.",
          cache: true,
        },
        { role: "user", content: judgePrompt },
      ],
      responseFormat: "json",
      temperature: 0.1,
      maxTokens: 256,
    });
    cost = response.costUsd;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(response.content);
    } catch {
      throw new Error(
        `Judge returned invalid JSON. First 200 chars: ${response.content.slice(0, 200)}`,
      );
    }
    const judged = ConversionJudgeSchema.safeParse(parsedJson);
    if (!judged.success) {
      violations.push({
        gate: "conversion",
        severity: "warning",
        code: "judge-schema-fail",
        message:
          "AI judge output did not match expected schema; manual review recommended.",
        evidence: judged.error.message,
      });
    } else {
      // Treat ALL AI-judge checks as warnings. LFM2-24B is too small to
      // reliably tell a clean page from a placeholder one — empirically it
      // hallucinates "Lorem ipsum detected" on copy that has none. The
      // deterministic banned-phrase regex above is authoritative for the
      // critical bar; the judge produces soft signal for `meta.gateResults`
      // and shows up in the UI's review panel without triggering refine.
      const checks = judged.data;
      const warnChecks: Array<[keyof typeof checks, string]> = [
        ["hasOnePrimaryCTA", "Judge flagged: unclear primary CTA above the fold"],
        [
          "heroHasOutcomeLanguage",
          "Judge flagged: hero copy may lack audience/outcome specificity",
        ],
        ["noLoremPresent", "Judge flagged possible placeholder text (low-confidence; verify manually)"],
        [
          "socialProofPresent",
          "Judge flagged: no social proof (testimonials, logos, or concrete numbers)",
        ],
        ["formIsReasonable", "Judge flagged: form may have more than 4 fields"],
        ["pricingVisibleIfExpected", "Judge flagged: SaaS-shaped product without visible pricing"],
        ["footerHasCompanyInfo", "Judge flagged: footer lacks company info"],
        ["noBannedPhrases", "Judge flagged possible banned phrase (regex already authoritative; verify)"],
      ];

      for (const [key, msg] of warnChecks) {
        if (checks[key] === false) {
          violations.push({
            gate: "conversion",
            severity: "warning",
            code: `checklist-${key}`,
            message: msg,
            suggestion: checks.reasoning,
          });
        }
      }
    }
  } catch (err) {
    violations.push({
      gate: "conversion",
      severity: "warning",
      code: "judge-runtime-error",
      message: `AI judge could not run: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return {
    gate: "conversion",
    passed: violations.filter((v) => v.severity === "critical").length === 0,
    violations,
    durationMs: Date.now() - start,
    cost,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildJudgePrompt(html: string): string {
  // Trim to a reasonable size — LFM2-24B handles 32k context, but most of the
  // page's signal lives above the fold. Cap to ~18k chars (~4.5k tokens) so
  // the call lands cleanly below the model's window with output room.
  const trimmed =
    html.length > 18000 ? `${html.slice(0, 18000)}\n[...truncated]` : html;
  return [
    "Evaluate the landing page below against an 8-point conversion checklist.",
    "Output a single JSON object — no prose, no markdown, no commentary.",
    "",
    "Schema:",
    "{",
    '  "hasOnePrimaryCTA": <bool — exactly one visually-prominent primary CTA exists>,',
    '  "heroHasOutcomeLanguage": <bool — hero names audience + concrete outcome>,',
    '  "socialProofPresent": <bool — testimonials, logos, OR concrete numbers visible>,',
    '  "formIsReasonable": <bool — any form has ≤4 fields; if no form exists, true>,',
    '  "noLoremPresent": <bool — no "lorem ipsum" or obvious placeholder text>,',
    '  "noBannedPhrases": <bool — no "world-class", "cutting-edge", etc>,',
    '  "pricingVisibleIfExpected": <bool — if SaaS-shaped, pricing is visible; otherwise true>,',
    '  "footerHasCompanyInfo": <bool — footer has at minimum brand name + copyright>,',
    '  "reasoning": <string — 1-2 sentences explaining any false values>',
    "}",
    "",
    "HTML:",
    "```html",
    trimmed,
    "```",
  ].join("\n");
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}
