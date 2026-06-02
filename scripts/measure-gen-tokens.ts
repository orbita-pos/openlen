// USER-RUN token + cost harness for the assembly-vs-generation decision.
//
// Runs a small set of representative briefs through the REAL generation path
// (generateHtmlStream — same model, system prompt, DESIGN_GUIDANCE/REFERENCE,
// maxOutputTokens and temperature as /api/generate) and reports the ACTUAL
// provider-reported input/output token counts and the per-generation cost at
// gemini-pro vs gemini-flash rates. This replaces the MODELED ~8000-output-token
// figure used in the research with measured numbers.
//
// MUST be run where Gemini egress is reachable AND the @openlen/* native crates
// are built (your machine or the Hetzner box) — it is BLOCKED in the sandbox.
//
//   npm run gen:measure                                   # default briefs, both models
//   npm run gen:measure -- --model=gemini-flash           # one model only
//   npm run gen:measure -- --brief="coffee subscription landing" --brief="a CRM pricing page"
//
// Credits: runs under a sentinel userId that does NOT exist, so the in-place
// debit (GREATEST(0, credits-amount) WHERE id=…) matches zero rows — no real
// user is charged. `credits` in the output shows what WOULD be billed.

import { generateHtmlStream } from "../lib/ai-stream/generate";
import { resolveAIProvider, type AIModel } from "../lib/ai-provider";
import { DESIGN_GUIDANCE, DESIGN_REFERENCE } from "../lib/design-guidance";
import type { Message } from "../lib/ai-gateway";

// Gemini USD per 1M tokens — mirror of lib/credits.ts RATES (module-private).
// Verify against ai.google.dev/pricing; lib/credits.ts flags them as Gemini-2.5
// placeholders.
const RATES = {
  "gemini-pro": { input: 1.25, output: 10 },
  "gemini-flash": { input: 0.3, output: 2.5 },
} as const;

// MODELED assembly "recipe" output size, for the projected comparison row only.
const RECIPE_OUTPUT_TOKENS = 300;

// ── Prompt construction — copied VERBATIM from app/api/generate/route.ts so the
// measured INPUT tokens match production. DESIGN_GUIDANCE + DESIGN_REFERENCE (the
// large, frequently-tuned parts) are imported live; only the static wrapper is
// duplicated. KEEP IN SYNC with route.ts if that wrapper changes. (OUTPUT tokens
// — the number that actually drives the decision — are exact regardless.)
// NOTE: production also attaches a curated screenshot (Quality S2) to the brief
// turn, which adds some INPUT tokens this text-only harness does not — so
// measured input is a slight UNDER-count; output is unaffected.
const SYSTEM_PROMPT = `You are a senior product designer-engineer hybrid with the eye of Linear, Vercel, Stripe, and Resend. You generate complete, production-grade landing pages from a short brief.

The user gives you a brief — sometimes specific, often vague or generic. Design and build the entire landing page yourself. You have FULL CREATIVE FREEDOM and the user trusts your taste. A vague or generic brief is your cue to apply judgment and taste, NOT to ask questions or fall back on something safe and forgettable.

${DESIGN_GUIDANCE}

OUTPUT EFFICIENCY (critical — long documents truncate against the response cap):
- No HTML comments (<!-- ... -->) anywhere in the output.
- No multi-line whitespace inside elements. Single-line each element when reasonable.
- Reuse Tailwind classes — if a card pattern repeats across siblings, give it one class in <style> and apply it instead of pasting the long class string.
- Collapse redundant CSS rules. No "/* Pricing */"-style section dividers in <style>.
- Inline <svg>: only emit what's needed; skip xmlns when duplicated across many siblings.
- Skip blank lines between sections of the document. Compact.
- Goal: same visual quality, fewer tokens.

NON-NEGOTIABLE CONSTRAINTS:
- Output a COMPLETE, self-contained HTML document: starts with <!doctype html>, ends with </html>.
- Include a descriptive <title> in <head> that names the product.
- Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
- Google Fonts via <link> in <head>. Allowed families: Inter, Geist, Fraunces, Source Serif 4, Crimson Pro, JetBrains Mono.
- All custom CSS inline in a <style> block in <head>. Use CSS custom properties on :root for design tokens (--accent, --accent-r as an RGB triplet, --bg, --surface, --fg, --border, --font-display, --font-body, --radius). Reference them via var() throughout — never hardcode the same color in many places. Also emit a \`:root.dark { … }\` block that redefines --bg, --surface, --fg, --border and --accent with hand-designed dark-theme values (a real dark palette — not a mechanical inversion); every text and heading color MUST resolve from a var() token so the whole page flips cleanly.
- NO React, NO Babel, NO JSX, NO <script type="text/babel">, NO window.X globals, NO import statements anywhere.
- NO data-slot-path= attribute anywhere — that is a reserved editor-mode marker.
- NO login / signup / "my account" / dashboard UI. Public marketing pages only.
- Inline SVG for logos / icons / illustrations. NO external image URLs. For hero / product imagery use a <div> with a tasteful bg-gradient-to-br placeholder.
- Mobile-responsive down to 360px width.

OUTPUT FORMAT — follow exactly:
Emit the complete HTML document directly, starting with <!doctype html> and ending with </html>. No preamble, no design notes, no markdown code fences — the first character of your response is <.`;

const REFERENCE_MESSAGE = `<reference>
The following library is the design taste catalog. Use it as material to draw from when filling in the variant brief — match the register, don't quote verbatim.

${DESIGN_REFERENCE}
</reference>`;

const DEFAULT_BRIEFS = [
  "a landing page for a developer tool that traces LLM agent runs",
  "a pricing page for a project-management SaaS for small teams",
  "a launch page for an indie coffee subscription brand",
];

interface Row {
  brief: string;
  model: AIModel;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  credits: number;
  stop: string;
}

function costUSD(model: keyof typeof RATES, inT: number, outT: number): number {
  const r = RATES[model];
  return (inT * r.input + outT * r.output) / 1_000_000;
}

function hr(title: string): void {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

async function runOne(brief: string, model: AIModel): Promise<Row | null> {
  const provider = resolveAIProvider(model);
  if (!provider.key) {
    throw new Error(
      `${provider.label} API key missing — set the Gemini key in .env.local`,
    );
  }
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: REFERENCE_MESSAGE },
    { role: "user", content: `BRIEF:\n${brief}` },
  ];
  const { stream, done } = generateHtmlStream({
    apiKey: provider.key,
    messages,
    model,
    userId: "__token-harness__",
    htmlOpts: { injectOpIds: false },
    maxOutputTokens: 65_536,
    temperature: 0.8,
  });
  // Drain the stream so `done` resolves cleanly and buffering stays bounded.
  const reader = stream.getReader();
  while (true) {
    const { done: d } = await reader.read();
    if (d) break;
  }
  const s = await done;
  if (s.stopKind === "error" || !s.usage) {
    console.error(
      `  [skip] ${model.padEnd(12)} "${brief.slice(0, 44)}" — ${s.error?.message ?? s.stopKind}`,
    );
    return null;
  }
  const cost = costUSD(model, s.usage.inputTokens, s.usage.outputTokens);
  console.log(
    `  ok   ${model.padEnd(12)} in=${String(s.usage.inputTokens).padStart(6)} ` +
      `out=${String(s.usage.outputTokens).padStart(6)} ` +
      `$${cost.toFixed(4)} (${s.creditsDebited}cr, ${s.stopKind})  "${brief.slice(0, 40)}"`,
  );
  return {
    brief,
    model,
    inputTokens: s.usage.inputTokens,
    outputTokens: s.usage.outputTokens,
    costUSD: cost,
    credits: s.creditsDebited,
    stop: s.stopKind,
  };
}

function parseArgs(): { briefs: string[]; models: AIModel[] } {
  const argv = process.argv.slice(2);
  let modelArg: AIModel | "both" = "both";
  const briefArgs: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--model=")) {
      const m = a.slice("--model=".length);
      if (m === "gemini-pro" || m === "gemini-flash") modelArg = m;
      else if (m === "both") modelArg = "both";
    } else if (a.startsWith("--brief=")) {
      const b = a.slice("--brief=".length).trim();
      if (b) briefArgs.push(b);
    }
  }
  return {
    briefs: briefArgs.length ? briefArgs : DEFAULT_BRIEFS,
    models: modelArg === "both" ? ["gemini-pro", "gemini-flash"] : [modelArg],
  };
}

async function main() {
  const { briefs, models } = parseArgs();

  hr("REAL token + cost measurement — full-HTML generation (production path)");
  console.log(
    `briefs: ${briefs.length}   models: ${models.join(", ")}   ` +
      `runs: ${briefs.length * models.length}`,
  );
  console.log(
    "calling the real /api/generate path (generateHtmlStream). Needs Gemini\n" +
      "egress + built native crates. No real user is charged (sentinel userId).\n",
  );

  const rows: Row[] = [];
  // Sequential — gentle on rate limits, and each call can be large/slow.
  for (const brief of briefs) {
    for (const model of models) {
      try {
        const r = await runOne(brief, model);
        if (r) rows.push(r);
      } catch (err) {
        console.error(`  [error] ${model} — ${(err as Error).message}`);
      }
    }
  }

  if (rows.length === 0) {
    hr("No successful runs");
    console.log(
      "Every run failed or was skipped. Most likely: Gemini egress blocked, the\n" +
        "native @openlen/* crates not built for this platform, or the API key\n" +
        "missing from .env.local. Run where /api/generate works.",
    );
    return;
  }

  // ── Per-model aggregates ──────────────────────────────────────────────
  hr("PER-MODEL AVERAGES (measured)");
  for (const model of models) {
    const ms = rows.filter((r) => r.model === model);
    if (ms.length === 0) continue;
    const avg = (f: (r: Row) => number) =>
      ms.reduce((s, r) => s + f(r), 0) / ms.length;
    const avgIn = avg((r) => r.inputTokens);
    const avgOut = avg((r) => r.outputTokens);
    const avgCost = avg((r) => r.costUSD);
    console.log(
      `${model.padEnd(12)} n=${ms.length}  ` +
        `avg in=${avgIn.toFixed(0)}  avg out=${avgOut.toFixed(0)}  ` +
        `avg cost=$${avgCost.toFixed(4)}  (avg ${avg((r) => r.credits).toFixed(1)} credits)`,
    );
  }

  // ── Headline: measured vs modeled, and the assembly projection ────────
  hr("ASSEMBLY PROJECTION (measured full-HTML vs MODELED recipe)");
  console.log(
    `Research assumed ~8000 output tokens for a full-HTML page. Measured above.\n`,
  );
  // Use the cheapest measured input as the recipe's input proxy (a recipe prompt
  // still carries the library context, so this is conservative — real recipe
  // input may be higher, shrinking the multiple).
  const minIn = Math.min(...rows.map((r) => r.inputTokens));
  const recipeFlashCost = costUSD("gemini-flash", minIn, RECIPE_OUTPUT_TOKENS);
  console.log(
    `recipe (MODELED ${RECIPE_OUTPUT_TOKENS} out, flash, in≈${minIn}) = $${recipeFlashCost.toFixed(4)}\n`,
  );
  for (const model of models) {
    const ms = rows.filter((r) => r.model === model);
    if (ms.length === 0) continue;
    const avgFullCost =
      ms.reduce((s, r) => s + r.costUSD, 0) / ms.length;
    const mult = avgFullCost / recipeFlashCost;
    console.log(
      `  full-HTML on ${model.padEnd(12)} ($${avgFullCost.toFixed(4)}) ` +
        `vs recipe-flash = ${mult.toFixed(0)}x cheaper`,
    );
  }
  console.log(
    "\nCAVEATS: recipe size is still MODELED (no assembler exists yet); a real\n" +
      "recipe prompt carries library context so its INPUT may be larger, which\n" +
      "would shrink the multiple. And if assembly needs an AI recolour pass per\n" +
      "section, add that cost back. Re-run with --brief=… on your real briefs.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
