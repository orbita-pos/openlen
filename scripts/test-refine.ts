import { writeFile } from "node:fs/promises";
import path from "node:path";
import { generateLandingPage } from "@/lib/orchestrator";
import { BLOCK_REGISTRY } from "@/lib/blocks/_registry";

// ─────────────────────────────────────────────────────────────────────────────
// Deliberate-violation test for the refine loop.
//
// We patch the hero/centered-cta exampleSlots to inject a banned phrase
// ("world-class") before running the pipeline. The mock fill step returns
// the exampleSlots verbatim, so the rendered page will contain the banned
// phrase. The conversion gate (deterministic banned-phrase regex) should
// flag a critical violation, the refine loop should fire, and after at
// most 2 attempts the page ships with qualityGrade != "passed".
//
// In the real pipeline the refine call would actually re-fill the block with
// the AI judge's feedback embedded in the prompt; in MOCK_MODE the fill mock
// returns the same exampleSlots each time, so the violation will persist and
// the page will ship as "needs_review". That's the expected behavior — this
// test verifies the LOOP fires, not that mock-mode could ever fix itself.
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const heroBlock = BLOCK_REGISTRY["hero/centered-cta"];
  const original = JSON.parse(JSON.stringify(heroBlock.meta.exampleSlots));
  // Inject a banned phrase into the hero headline.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (heroBlock.meta as any).exampleSlots = {
    ...heroBlock.meta.exampleSlots,
    headline: "World-class platform that revolutionizes your workflow",
  };

  try {
    const page = await generateLandingPage({
      brief:
        "Landing page for FlowDeck, a Kanban tool for designers that uses AI to prioritize tasks. Features: AI prioritization, real-time sync, Slack integration. Pricing tiers: Free, Pro $29/mo, Team $99/mo.",
      maxBudget: 1.0,
      onProgress: (e) => {
        const detail = e.details ? ` — ${e.details}` : "";
        console.log(`  ${e.step.padEnd(18)} ${e.status.padEnd(10)}${detail}`);
      },
    });

    const summary = {
      qualityGrade: page.meta.qualityGrade,
      refineAttempts: page.meta.refineAttempts,
      criticalViolations:
        page.meta.gateResults?.criticalViolations.map((v) => ({
          gate: v.gate,
          code: v.code,
          message: v.message,
        })) ?? [],
      allGatesPassed: page.meta.gateResults?.passed,
      gatesPassed: page.meta.gateResults
        ? Object.values(page.meta.gateResults.byGate)
            .filter((g) => g.passed)
            .map((g) => g.gate)
        : [],
      gatesFailed: page.meta.gateResults
        ? Object.values(page.meta.gateResults.byGate)
            .filter((g) => !g.passed)
            .map((g) => g.gate)
        : [],
    };

    console.log("\n=== Summary ===");
    console.log(JSON.stringify(summary, null, 2));

    await writeFile(
      path.join(process.cwd(), "evals", "refine-injection-result.json"),
      JSON.stringify(summary, null, 2),
      "utf8",
    );

    // Assertion-style success check.
    const ok =
      summary.refineAttempts !== undefined &&
      summary.refineAttempts >= 1 &&
      summary.criticalViolations.some((v) => v.gate === "conversion");
    if (ok) {
      console.log(
        "\n✓ Refine loop triggered as expected (conversion gate fired on banned phrase).",
      );
    } else {
      console.log(
        "\n✗ Refine loop did NOT fire — banned phrase was not caught.",
      );
      process.exit(1);
    }
  } finally {
    // Restore exampleSlots so subsequent runs aren't poisoned.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (heroBlock.meta as any).exampleSlots = original;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
