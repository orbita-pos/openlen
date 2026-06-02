// Phase 0 spike judge (docs/spike-phase0.md). Blind PAIRWISE vision comparison
// of ASSEMBLED vs BESPOKE pages → does assemble-then-recolour match/beat bespoke?
//
// Drop pairs in a dir: <id>.bespoke.html (from /api/generate) + <id>.assembled.html
// (hand-built in-app via Library insert → "Use on my page"), optional <id>.brief.txt.
//
//   npm run spike:judge -- ./spike
//
// Each pair is judged in BOTH A/B orderings (a winner that flips on swap = position
// bias = tie) on: coherence, craft, brief-fit, overall. Prints a scorecard + gate.
//
// USER-RUN: needs Gemini egress + a Chrome for puppeteer. The AI verdict is a
// SECOND opinion — your own eye on the 3 pages is the primary judge.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GeminiProvider, type InlineImage } from "../lib/ai-gateway";
import { renderHtmlToInlineImage } from "../lib/ai/inline-image";
import { resolveAIProvider } from "../lib/ai-provider";

type Choice = "A" | "B" | "tie";
type Side = "bespoke" | "assembled" | "tie";

interface PairVerdict {
  coherenceWinner: Choice;
  craftWinner: Choice;
  briefFitWinner: Choice;
  overallWinner: Choice;
  confidence: string;
  reasoning: string;
}

// Gemini OpenAPI-subset schema (UPPERCASE types, like lib/ai/vision-critique.ts).
const SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    coherenceWinner: { type: "STRING" },
    craftWinner: { type: "STRING" },
    briefFitWinner: { type: "STRING" },
    overallWinner: { type: "STRING" },
    confidence: { type: "STRING" },
    reasoning: { type: "STRING" },
  },
  required: ["coherenceWinner", "craftWinner", "briefFitWinner", "overallWinner", "confidence", "reasoning"],
  propertyOrdering: ["coherenceWinner", "craftWinner", "briefFitWinner", "overallWinner", "confidence", "reasoning"],
};

function coerce(v: unknown): Choice {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "A" ? "A" : s === "B" ? "B" : "tie";
}

function buildPrompt(brief: string): string {
  return [
    "You are a ruthless senior product-design director comparing two landing pages, A and B, for the SAME brief.",
    "Judge at the level of Linear / Vercel / Stripe / Anthropic. Reward restraint + craft; punish slop and mismatched seams.",
    `BRIEF: ${brief}`,
    "Two screenshots are attached: the FIRST image is A, the SECOND is B.",
    "Pick a winner (A, B, or tie) for each:",
    "- coherenceWinner: reads as ONE coherent brand — consistent accent, type, spacing, no mismatched seams?",
    "- craftWinner: hero polish, spacing rhythm, type hierarchy, color discipline — clearly hand-made-quality?",
    "- briefFitWinner: better answers the brief (industry, tone, the right sections)?",
    "- overallWinner: which would you SHIP?",
    "Plus confidence (high/medium/low) and a one-paragraph reasoning. Be decisive; 'tie' only when truly indistinguishable.",
  ].join("\n");
}

async function judge(
  model: string,
  apiKey: string,
  brief: string,
  first: InlineImage,
  second: InlineImage,
): Promise<PairVerdict | null> {
  const provider = new GeminiProvider(apiKey);
  let raw = "";
  try {
    for await (const ev of provider.stream(
      {
        model,
        messages: [{ role: "user", content: buildPrompt(brief) }],
        images: [first, second],
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
        maxOutputTokens: 2048,
        temperature: 0.2,
      },
      {},
    )) {
      if (ev.type === "text_delta") raw += ev.text;
      else if (ev.type === "done" && ev.stopReason.kind === "error") {
        console.error("    gemini error:", ev.stopReason.error);
        return null;
      }
    }
  } catch (e) {
    console.error("    judge call failed:", (e as Error).message);
    return null;
  }
  try {
    const j = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "").trim());
    return {
      coherenceWinner: coerce(j.coherenceWinner),
      craftWinner: coerce(j.craftWinner),
      briefFitWinner: coerce(j.briefFitWinner),
      overallWinner: coerce(j.overallWinner),
      confidence: String(j.confidence ?? "?"),
      reasoning: String(j.reasoning ?? ""),
    };
  } catch {
    console.error("    malformed verdict JSON");
    return null;
  }
}

// Map a round's Choice back to which design won, given which label was bespoke.
function unblind(c: Choice, bespokeLabel: "A" | "B"): Side {
  if (c === "tie") return "tie";
  return c === bespokeLabel ? "bespoke" : "assembled";
}

// Two orderings must AGREE; a flip on position-swap = too close = tie.
function reconcile(r1: Side, r2: Side): Side {
  return r1 === r2 ? r1 : "tie";
}

async function main() {
  const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "./spike";
  const provider = resolveAIProvider("gemini-flash");
  const key = provider.key;
  if (!key) {
    console.error("Gemini API key missing — set it in .env.local");
    process.exit(1);
  }
  const model = provider.model;

  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    console.error(`Cannot read dir ${dir}`);
    process.exit(1);
  }
  const ids = [
    ...new Set(
      files
        .filter((f) => /\.(bespoke|assembled)\.html$/.test(f))
        .map((f) => f.replace(/\.(bespoke|assembled)\.html$/, "")),
    ),
  ].sort();
  if (ids.length === 0) {
    console.error(`No <id>.bespoke.html / <id>.assembled.html pairs found in ${dir}`);
    process.exit(1);
  }

  console.log(`Phase 0 spike — judging ${ids.length} pair(s) in ${dir}\n`);
  const tally: Record<Side, number> = { bespoke: 0, assembled: 0, tie: 0 };

  for (const id of ids) {
    let brief = `(brief ${id})`;
    try {
      brief = readFileSync(join(dir, `${id}.brief.txt`), "utf8").trim();
    } catch {
      /* brief.txt optional */
    }
    let bespokeHtml: string;
    let assembledHtml: string;
    try {
      bespokeHtml = readFileSync(join(dir, `${id}.bespoke.html`), "utf8");
      assembledHtml = readFileSync(join(dir, `${id}.assembled.html`), "utf8");
    } catch (e) {
      console.log(`  ${id}: missing file — ${(e as Error).message}`);
      continue;
    }

    const imgBespoke = await renderHtmlToInlineImage(bespokeHtml);
    const imgAssembled = await renderHtmlToInlineImage(assembledHtml);
    if (!imgBespoke || !imgAssembled) {
      console.log(`  ${id}: render failed — skipped`);
      continue;
    }

    // round 1: A=bespoke, B=assembled ; round 2: swapped
    const v1 = await judge(model, key, brief, imgBespoke, imgAssembled);
    const v2 = await judge(model, key, brief, imgAssembled, imgBespoke);
    if (!v1 || !v2) {
      console.log(`  ${id}: judge failed — skipped`);
      continue;
    }

    const overall = reconcile(unblind(v1.overallWinner, "A"), unblind(v2.overallWinner, "B"));
    const coh = reconcile(unblind(v1.coherenceWinner, "A"), unblind(v2.coherenceWinner, "B"));
    const craft = reconcile(unblind(v1.craftWinner, "A"), unblind(v2.craftWinner, "B"));
    const fit = reconcile(unblind(v1.briefFitWinner, "A"), unblind(v2.briefFitWinner, "B"));
    tally[overall]++;
    console.log(
      `  ${id}: OVERALL=${overall.toUpperCase()}  (coherence=${coh} · craft=${craft} · brief-fit=${fit})`,
    );
    console.log(`      ${v1.reasoning.slice(0, 200)}`);
  }

  console.log(`\nAGGREGATE — assembled:${tally.assembled}  bespoke:${tally.bespoke}  tie:${tally.tie}`);
  const recommend =
    tally.bespoke === 0 || tally.assembled >= tally.bespoke
      ? "BUILD the assembler — assembly matches/beats bespoke (per the AI second-opinion)."
      : "FALL BACK — bespoke wins; ship curation + template-reference retrieval, NOT a recipe engine.";
  console.log(`GATE (AI second-opinion): ${recommend}`);
  console.log(
    "\nNOTE: N is tiny and this is the AI's view. Weigh your recorded LATENCY and — decisively — YOUR eye on the 3 pages (Fork #4).",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
