import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { generateLandingPage } from "@/lib/orchestrator";
import type { ProgressEvent } from "@/lib/orchestrator/types";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 evaluation harness.
//
// Runs the 5-brief eval suite end-to-end against the real Together API,
// captures per-brief artifacts under evals/<slug>/, and prints a summary table.
// Run with: npm run eval [-- <slug>] (slug optional, runs all if omitted).
//
// Each brief writes:
//   evals/<slug>/output.html        — the full landing page (with iframe wrapper)
//   evals/<slug>/output.raw.html    — raw <main> body only
//   evals/<slug>/output.css         — extracted CSS
//   evals/<slug>/witness.jsonl      — copy of the recording
//   evals/<slug>/cost.json          — cost breakdown + timing + intent
//   evals/<slug>/progress.log       — SSE progress events as they fired
// ─────────────────────────────────────────────────────────────────────────────

interface Brief {
  slug: string;
  label: string;
  brief: string;
}

const BRIEFS: Brief[] = [
  {
    slug: "01-saas-launch",
    label: "SaaS launch",
    brief:
      "Landing page for FlowDeck, a Kanban tool for designers that uses AI to prioritize tasks. Features: AI prioritization, real-time sync, Slack integration. Pricing tiers: Free, Pro $29/mo, Team $99/mo.",
  },
  {
    slug: "02-portfolio",
    label: "Portfolio personal",
    brief:
      "Personal portfolio for a freelance UI/UX designer based in Mexico City named Sofia. She specializes in fintech and SaaS. Wants to showcase 6 projects and have a contact section.",
  },
  {
    slug: "03-event-conference",
    label: "Event / conference",
    brief:
      "Landing page for 'Solo Founder Summit 2026', a 1-day virtual conference for indie hackers. October 15. Speakers: Pieter Levels, Justin Welsh, Marc Lou. Tickets $99 early bird.",
  },
  {
    slug: "04-ecommerce",
    label: "E-commerce",
    brief:
      "Landing page for 'Volcánica', a single-origin coffee subscription from Mexican volcanoes. Hero: bag of coffee on volcanic stone. Subscription tiers: $19 monthly, $49 quarterly. Mission: support Mexican farmers.",
  },
  {
    slug: "05-agency",
    label: "Agency",
    brief:
      "Landing page for 'Pixelhaus', a 3-person brand identity agency from Berlin. Show 4 client logos, 3 case studies (Brewdog, Patagonia, local startup). Contact via Calendly embed mention.",
  },
];

const EVAL_DIR = path.join(process.cwd(), "evals");
const RECORDINGS_DIR = path.join(process.cwd(), "recordings");

async function ensureDir(p: string) {
  if (!existsSync(p)) await mkdir(p, { recursive: true });
}

function buildSrcDoc(_title: string, html: string, _css: string): string {
  // In the slot-filling pipeline, page.html is already a complete <!doctype>
  // document built by lib/orchestrator/assemble.tsx — no wrapping needed.
  return html;
}

interface RunSummary {
  slug: string;
  label: string;
  ok: boolean;
  errorMessage?: string;
  totalCostUsd?: number;
  wallClockMs?: number;
  imagesGenerated?: number;
  fastPath?: boolean;
  intent?: unknown;
  qualityGrade?: string;
  gatesPassed?: number;
  gatesTotal?: number;
  refineAttempts?: number;
}

async function runOne(b: Brief): Promise<RunSummary> {
  const outDir = path.join(EVAL_DIR, b.slug);
  await ensureDir(outDir);

  console.log(`\n▶ ${b.slug} — ${b.label}`);
  console.log(`  brief: ${b.brief.slice(0, 80)}…`);

  const progressLog: ProgressEvent[] = [];
  const t0 = Date.now();
  try {
    const page = await generateLandingPage({
      brief: b.brief,
      maxBudget: 1.0,
      onProgress: (e) => {
        progressLog.push(e);
        const cost = e.costSoFar !== undefined ? ` ($${e.costSoFar.toFixed(4)})` : "";
        const detail = e.details ? ` — ${e.details}` : "";
        console.log(`    ${e.step.padEnd(18)} ${e.status.padEnd(10)}${cost}${detail}`);
      },
    });
    const wall = Date.now() - t0;

    const srcDoc = buildSrcDoc(page.meta.title, page.html, page.css);
    await writeFile(path.join(outDir, "output.html"), srcDoc, "utf8");
    await writeFile(path.join(outDir, "output.raw.html"), page.html, "utf8");
    await writeFile(path.join(outDir, "output.css"), page.css, "utf8");

    // Copy the witness recording in place.
    const witnessAbs = path.join(RECORDINGS_DIR, path.basename(page.witnessPath));
    if (existsSync(witnessAbs)) {
      const wj = await readFile(witnessAbs, "utf8");
      await writeFile(path.join(outDir, "witness.jsonl"), wj, "utf8");
    }

    await writeFile(
      path.join(outDir, "cost.json"),
      JSON.stringify(
        {
          slug: b.slug,
          label: b.label,
          brief: b.brief,
          totalCostUsd: page.cost.total,
          breakdown: page.cost,
          wallClockMs: wall,
          adaptiveFastPath: page.adaptiveFastPath,
          imagesGenerated: page.images.length,
          intent: page.meta.intent,
          generationId: page.meta.generationId,
          qualityGrade: page.meta.qualityGrade,
          refineAttempts: page.meta.refineAttempts,
          gatesPassed: page.meta.gateResults
            ? Object.values(page.meta.gateResults.byGate).filter((g) => g.passed).length
            : undefined,
          gatesTotal: page.meta.gateResults
            ? Object.keys(page.meta.gateResults.byGate).length
            : undefined,
          gateViolationCount: page.meta.gateResults?.allViolations.length,
          // Persist the full gate results so a failing brief is easy to diagnose
          // post-hoc without re-running the (expensive) pipeline.
          gateResults: page.meta.gateResults
            ? {
                passed: page.meta.gateResults.passed,
                criticalViolations: page.meta.gateResults.criticalViolations,
                byGate: Object.fromEntries(
                  Object.entries(page.meta.gateResults.byGate).map(([k, g]) => [
                    k,
                    {
                      passed: g.passed,
                      durationMs: g.durationMs,
                      cost: g.cost,
                      violationCount: g.violations.length,
                      violations: g.violations.slice(0, 10),
                    },
                  ]),
                ),
              }
            : undefined,
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeFile(
      path.join(outDir, "progress.log"),
      progressLog
        .map(
          (e) =>
            `${e.step}\t${e.status}\t${e.costSoFar?.toFixed(4) ?? ""}\t${e.details ?? ""}`,
        )
        .join("\n"),
      "utf8",
    );

    console.log(
      `  ✓ done in ${(wall / 1000).toFixed(1)}s, $${page.cost.total.toFixed(4)}, ${page.images.length} images`,
    );

    return {
      slug: b.slug,
      label: b.label,
      ok: true,
      totalCostUsd: page.cost.total,
      wallClockMs: wall,
      imagesGenerated: page.images.length,
      fastPath: page.adaptiveFastPath,
      intent: page.meta.intent,
      qualityGrade: page.meta.qualityGrade,
      gatesPassed: page.meta.gateResults
        ? Object.values(page.meta.gateResults.byGate).filter((g) => g.passed).length
        : undefined,
      gatesTotal: page.meta.gateResults
        ? Object.keys(page.meta.gateResults.byGate).length
        : undefined,
      refineAttempts: page.meta.refineAttempts,
    };
  } catch (err) {
    const wall = Date.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ failed in ${(wall / 1000).toFixed(1)}s: ${message}`);

    await writeFile(
      path.join(outDir, "error.json"),
      JSON.stringify(
        {
          slug: b.slug,
          label: b.label,
          brief: b.brief,
          error: message,
          stack: err instanceof Error ? err.stack : undefined,
          wallClockMs: wall,
          progressLog,
        },
        null,
        2,
      ),
      "utf8",
    );

    return {
      slug: b.slug,
      label: b.label,
      ok: false,
      errorMessage: message,
      wallClockMs: wall,
    };
  }
}

async function main() {
  await ensureDir(EVAL_DIR);
  const onlySlug = process.argv[2];
  const briefs = onlySlug ? BRIEFS.filter((b) => b.slug === onlySlug) : BRIEFS;
  if (briefs.length === 0) {
    console.error(`No brief matched "${onlySlug}". Available: ${BRIEFS.map((b) => b.slug).join(", ")}`);
    process.exit(1);
  }

  const summaries: RunSummary[] = [];
  for (const b of briefs) {
    const s = await runOne(b);
    summaries.push(s);
  }

  console.log("\n=== SUMMARY ===");
  let totalCost = 0;
  let totalTime = 0;
  for (const s of summaries) {
    if (s.ok) {
      totalCost += s.totalCostUsd ?? 0;
      totalTime += s.wallClockMs ?? 0;
      const gateBadge =
        s.gatesPassed !== undefined && s.gatesTotal !== undefined
          ? ` ${s.gatesPassed}/${s.gatesTotal} gates`
          : "";
      const gradeBadge = s.qualityGrade ? ` [${s.qualityGrade}]` : "";
      const refineBadge =
        s.refineAttempts && s.refineAttempts > 0 ? ` ${s.refineAttempts}× refine` : "";
      console.log(
        `  ${s.slug}  $${(s.totalCostUsd ?? 0).toFixed(4)}  ${((s.wallClockMs ?? 0) / 1000).toFixed(1)}s  ${s.imagesGenerated} images  ${s.fastPath ? "[fastpath]" : ""}${gateBadge}${gradeBadge}${refineBadge}`,
      );
    } else {
      console.log(`  ${s.slug}  FAILED: ${s.errorMessage}`);
    }
  }
  const okCount = summaries.filter((s) => s.ok).length;
  console.log(
    `\nTotals: ${okCount}/${summaries.length} succeeded · $${totalCost.toFixed(4)} · ${(totalTime / 1000).toFixed(1)}s wall-clock`,
  );

  await writeFile(
    path.join(EVAL_DIR, "summary.json"),
    JSON.stringify(summaries, null, 2),
    "utf8",
  );
}

main().catch((e) => {
  console.error("eval harness crashed:", e);
  process.exit(1);
});
