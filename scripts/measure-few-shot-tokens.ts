import {
  loadFewShots,
  resetFewShotRotation,
  type FewShotExample,
} from "../lib/orchestrator/few-shots";
import { PALETTES } from "../lib/orchestrator/design-tokens";
import { buildMasterPrompt } from "../lib/orchestrator/master-prompt";

// ─────────────────────────────────────────────────────────────────────────────
// Measure the token cost of the few-shot block when injected into the master
// prompt. The model bills input tokens, so this is the dominant per-call cost
// for steps that include few-shot (plan, copy, html, copy-regen).
//
// We use the 4-chars-per-token heuristic (Anthropic / OpenAI tokenizer
// average for English mixed with code). It's a rough upper bound for JSX —
// real BPE often hits closer to 3.5 because className tokens are common —
// so the printed numbers will overstate slightly. Good for budget headroom.
//
// Run with: npx tsx scripts/measure-few-shot-tokens.ts
// ─────────────────────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4;

function approxTokens(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

function fmtTokens(n: number): string {
  return n.toLocaleString();
}

async function measureOnce(label: string, paletteName: keyof typeof PALETTES): Promise<void> {
  const palette = PALETTES[paletteName];
  const preferred = palette.aestheticDirections[0];
  const fewShots = await loadFewShots({ preferredDirection: preferred });

  console.log(`\n── ${label}  (palette: ${paletteName}, preferred: ${preferred}) ──`);
  let exampleTotal = 0;
  fewShots.forEach((ex: FewShotExample, i: number) => {
    const t = approxTokens(ex.content);
    exampleTotal += t;
    console.log(
      `  Example ${i + 1}: ${ex.direction}/${ex.variant.padEnd(8)}  ${fmtTokens(t).padStart(7)} tokens  (${(
        ex.content.length / 1024
      ).toFixed(1)} KB)`,
    );
  });

  const prompt = buildMasterPrompt({
    palette,
    fewShotExamples: fewShots,
    taskSpecificAdditions:
      "TASK: This is a measurement-only call. The real per-step task addendum is ~600-800 tokens (HTML is the largest).",
  });

  const promptTokens = approxTokens(prompt);
  const wrapperTokens = promptTokens - exampleTotal;
  console.log(`  ─ Examples total:      ${fmtTokens(exampleTotal).padStart(7)} tokens`);
  console.log(`  ─ Prompt scaffolding:  ${fmtTokens(wrapperTokens).padStart(7)} tokens`);
  console.log(`  ─ FULL system prompt:  ${fmtTokens(promptTokens).padStart(7)} tokens`);
}

async function main() {
  console.log("Few-shot token budget measurement\n=================================");
  console.log(`Heuristic: ~${CHARS_PER_TOKEN} chars/token (~10–15% high vs. real BPE for code).\n`);

  // One run per palette family to surface variance: examples differ per call
  // due to rotation, so we measure with the rotation counter reset to zero.
  resetFewShotRotation();
  await measureOnce("emerald-dark — technical-minimal preferred", "emerald-dark");
  await measureOnce("warm-dark — refined-editorial preferred", "warm-dark");
  await measureOnce("mono-light — refined-editorial preferred", "mono-light");
  await measureOnce("mono-dark — technical-minimal preferred (default)", "mono-dark");

  console.log(
    "\nBudget guidance: Together AI Qwen3-Coder / Kimi K2.6 context = 128K tokens.",
  );
  console.log(
    "If FULL system prompt < 25K we leave generous room for the user message",
  );
  console.log("(plan JSON + copy JSON ~ 2–4K) and the model output (~6–8K for html).");
}

main().catch((err) => {
  console.error("measure-few-shot-tokens failed:", err);
  process.exit(1);
});
