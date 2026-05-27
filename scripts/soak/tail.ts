// Summarizer for the F1 shadow-soak JSONL log.
//
// Reads the divergence records produced by scripts/soak/run.ts (or by a
// production-wired setShadowLogger), aggregates by call-site, surfaces the
// optimize-html byte-delta histogram (telemetry for Sem 8.5 Tailwind bake
// planning), and prints a verdict + exit code:
//   0  ✅ SAFE TO FLIP        — actionable=0 AND total>=100
//   1  ⚠️  NEED MORE SAMPLES  — actionable=0 but total<100
//   1  ❌ NOT READY           — actionable>=1
//
// Usage:
//   npx tsx scripts/soak/tail.ts [path/to/log.jsonl]
//
// Default path: $SOAK_LOG or "soak-log.jsonl" in cwd.

import { readFile } from "node:fs/promises";
import process from "node:process";

import type { ShadowDivergenceRecord } from "@/lib/shadow-soak";

const TARGET_SAMPLE_SIZE = 100;

async function readJsonl(path: string): Promise<ShadowDivergenceRecord[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`[soak/tail] log file not found: ${path}`);
      process.exit(2);
    }
    throw err;
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const records: ShadowDivergenceRecord[] = [];
  let skipped = 0;
  for (let i = 0; i < lines.length; i += 1) {
    try {
      records.push(JSON.parse(lines[i]));
    } catch {
      skipped += 1;
    }
  }
  if (skipped > 0) {
    console.warn(`[soak/tail] skipped ${skipped} non-JSON lines`);
  }
  return records;
}

function groupBy<T>(items: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    if (!out[k]) out[k] = [];
    out[k].push(item);
  }
  return out;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor(sorted.length * q), sorted.length - 1);
  return sorted[idx];
}

async function main(): Promise<void> {
  const logPath = process.argv[2] ?? process.env.SOAK_LOG ?? "soak-log.jsonl";
  const records = await readJsonl(logPath);

  const total = records.length;
  const actionable = records.filter((r) => r.errorShapeMismatch).length;
  const byName = groupBy(records, (r) => r.name);

  console.log("─".repeat(72));
  console.log(`SOAK SUMMARY — ${logPath}`);
  console.log("─".repeat(72));
  console.log(`Total divergences:     ${total}`);
  console.log(`Actionable (errShape): ${actionable}`);
  console.log();
  console.log("By call site:");
  const siteNames = Object.keys(byName).sort();
  for (const name of siteNames) {
    const group = byName[name];
    const errs = group.filter((r) => r.errorShapeMismatch).length;
    console.log(
      `  ${name.padEnd(34)} total=${String(group.length).padStart(5)}  actionable=${String(errs).padStart(4)}`,
    );
  }

  // Byte-delta histogram for optimize-html (Sem 8.5 planning data).
  const optRecords = byName["optimize-html-for-production"] ?? [];
  if (optRecords.length > 0) {
    const deltas = optRecords
      .map((r) => r.rustBytes - r.tsBytes)
      .sort((a, b) => a - b);
    console.log();
    console.log("optimize-html byte delta (rustBytes − tsBytes):");
    console.log(`  count: ${deltas.length}`);
    console.log(`  min:   ${deltas[0]}`);
    console.log(`  p50:   ${quantile(deltas, 0.5)}`);
    console.log(`  p95:   ${quantile(deltas, 0.95)}`);
    console.log(`  max:   ${deltas[deltas.length - 1]}`);
  }

  // Verdict.
  console.log();
  console.log("─".repeat(72));
  if (actionable === 0 && total >= TARGET_SAMPLE_SIZE) {
    console.log(`✅ SAFE TO FLIP — 0 actionable divergences, sample size OK (>= ${TARGET_SAMPLE_SIZE})`);
    process.exit(0);
  } else if (actionable === 0) {
    console.log(
      `⚠️  NEED MORE SAMPLES — 0 actionable but only ${total} records (target ≥ ${TARGET_SAMPLE_SIZE})`,
    );
    process.exit(1);
  } else {
    console.log(`❌ NOT READY — ${actionable} actionable divergences need investigation`);
    console.log();
    console.log("First 5 actionable records:");
    const sample = records.filter((r) => r.errorShapeMismatch).slice(0, 5);
    for (const r of sample) {
      const tsPrev = r.tsValuePreview.slice(0, 120).replace(/\n/g, "\\n");
      const rustPrev = r.rustValuePreview.slice(0, 120).replace(/\n/g, "\\n");
      console.log(`  [${r.name}]`);
      console.log(`    args:  ${r.argsSummary}`);
      console.log(`    ts:    ${tsPrev}`);
      console.log(`    rust:  ${rustPrev}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[soak/tail] fatal:", err);
  process.exit(2);
});
