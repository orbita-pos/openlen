// Corpus health audit for the section library. Scans every stored section
// fragment against the known breakage classes and prints an organized
// inventory — so no section is silently broken / "lost". With --fix it also
// repairs the one auto-fixable class (flush-left max-width wrappers, via
// centerOrphanedMaxWidth) in place and re-uploads.
//
//   npm run sections:audit                 # report (all statuses)
//   npm run sections:audit -- --published  # only published
//   npm run sections:audit -- --json       # machine-readable
//   npm run sections:audit -- --fix        # apply safe centering repairs
//
// Read-only by default. --fix only touches the `flush-left` class; everything
// else is reported for a human to look at (slot-path, unparseable CSS, empty
// fragments, leftover 100vh shells, missing semantic landmark).
import postcss from "postcss";
import {
  listAllSectionsForAdmin,
  getSectionHtml,
  upsertSection,
  type SectionRecord,
} from "../lib/sections/store";
import { centerOrphanedMaxWidth } from "../lib/sections/scope";

type Severity = "critical" | "high" | "medium" | "low";
interface Issue {
  code: string;
  severity: Severity;
  detail: string;
  fixable?: boolean;
}

const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEV_ICON: Record<Severity, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "⚪" };

function styleBlocks(html: string): string[] {
  const out: string[] = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

// Per-<style>-block centering repair, mirroring the host-adopt backfill so the
// rest of the fragment stays byte-identical.
function repairFragment(html: string, slug: string): { html: string; centered: string[] } {
  const centered: string[] = [];
  const next = html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_full, open: string, css: string, close: string) => {
      const r = centerOrphanedMaxWidth(css, slug);
      centered.push(...r.centered);
      return `${open}${r.css}${close}`;
    },
  );
  return { html: next, centered };
}

function lint(html: string, rec: SectionRecord): Issue[] {
  const issues: Issue[] = [];
  const slug = rec.id;
  const blocks = styleBlocks(html);
  const allCss = blocks.join("\n");

  // CRITICAL — a reserved editor marker must never reach storage; publish rejects it.
  if (/data-slot-path\s*=/.test(html)) {
    issues.push({ code: "slot-path", severity: "critical", detail: "reserved data-slot-path marker present" });
  }

  // HIGH — a <style> block that doesn't parse renders unstyled.
  for (const css of blocks) {
    try {
      postcss.parse(css);
    } catch (e) {
      issues.push({ code: "css-parse-error", severity: "high", detail: (e as Error).message.replace(/\s+/g, " ").slice(0, 70) });
      break;
    }
  }

  // HIGH — fragment with no element content (a lost/empty section).
  const markup = html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  if (!/<(section|header|footer|nav|main|article|aside|div)\b/i.test(markup)) {
    issues.push({ code: "empty", severity: "high", detail: "no element content" });
  }

  // MEDIUM — a 100vh preview-shell height that should have been stripped at ingest.
  if (/(min-height|height)\s*:\s*\d*\.?\d+(vh|dvh|svh|lvh)/i.test(allCss)) {
    issues.push({ code: "viewport-leftover", severity: "medium", detail: "100vh shell height not stripped" });
  }

  // MEDIUM (FIXABLE) — an orphaned max-width wrapper with no margin:auto.
  const { centered } = repairFragment(html, slug);
  if (centered.length > 0) {
    issues.push({
      code: "flush-left",
      severity: "medium",
      detail: `${centered.length} wrapper(s) — ${centered[0]}`,
      fixable: true,
    });
  }

  // LOW — root is a plain <div>, no semantic landmark.
  if (rec.rootTag === "div") {
    issues.push({ code: "no-landmark", severity: "low", detail: "root is <div>" });
  }

  return issues.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fix = args.includes("--fix");
  const json = args.includes("--json");
  const publishedOnly = args.includes("--published");

  let recs = await listAllSectionsForAdmin();
  if (publishedOnly) recs = recs.filter((r) => r.status === "published");

  const report: {
    id: string;
    type: string;
    mode: string;
    status: string;
    issues: Issue[];
    repaired: boolean;
  }[] = [];
  const byCode: Record<string, number> = {};
  const failed: { id: string; reason: string }[] = [];
  let repairedCount = 0;

  for (const rec of recs) {
    const html = await getSectionHtml(rec.id);
    if (html === null) {
      failed.push({ id: rec.id, reason: "no stored HTML" });
      continue;
    }
    const issues = lint(html, rec);
    for (const i of issues) byCode[i.code] = (byCode[i.code] ?? 0) + 1;

    let repaired = false;
    if (fix && issues.some((i) => i.code === "flush-left")) {
      const { html: next } = repairFragment(html, rec.id);
      if (next !== html) {
        try {
          await upsertSection({
            id: rec.id,
            type: rec.type,
            name: rec.name,
            variantLabel: rec.variantLabel,
            rootTag: rec.rootTag,
            mode: rec.mode,
            html: next,
            designTokens: rec.designTokens ?? undefined,
            fonts: rec.fonts ?? undefined,
            needsJs: rec.needsJs,
            hasPlaceholders: rec.hasPlaceholders,
            status: rec.status,
          });
          repaired = true;
          repairedCount++;
        } catch (err) {
          failed.push({ id: rec.id, reason: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    if (issues.length > 0) report.push({ id: rec.id, type: rec.type, mode: rec.mode, status: rec.status, issues, repaired });
  }

  if (json) {
    console.log(JSON.stringify({ total: recs.length, flagged: report.length, byCode, repairedCount, report, failed }, null, 2));
    if (failed.length > 0) process.exit(1);
    return;
  }

  console.log(`\nSECTION AUDIT — ${recs.length} sections${publishedOnly ? " [published]" : ""}${fix ? " [--fix]" : " [report]"}\n`);
  for (const r of report) {
    const head = `  ${r.id.padEnd(18)} ${r.type.padEnd(13)} ${r.mode.padEnd(6)}`;
    const tags = r.issues
      .map((i) => `${SEV_ICON[i.severity]} ${i.code}${i.fixable ? (r.repaired ? "✓fixed" : "") : ""}`)
      .join("  ");
    console.log(`${head} ${tags}`);
    for (const i of r.issues) console.log(`${" ".repeat(40)}↳ ${i.code}: ${i.detail}`);
  }

  console.log(`\n── summary ──`);
  const codes = Object.keys(byCode).sort((a, b) => byCode[b] - byCode[a]);
  if (codes.length === 0) console.log("  no issues — corpus clean ✅");
  for (const c of codes) console.log(`  ${c.padEnd(18)} ${byCode[c]}${c === "flush-left" ? " (fixable with --fix)" : ""}`);
  console.log(`\n  flagged ${report.length} / ${recs.length}   clean ${recs.length - report.length}`);
  if (fix) console.log(`  repaired ${repairedCount} flush-left section(s)`);
  if (failed.length > 0) {
    console.log(`\n  !! ${failed.length} could not be read/written:`);
    for (const f of failed) console.log(`     ${f.id} — ${f.reason}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
