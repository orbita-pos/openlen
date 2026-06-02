// Validation harness for the assembler pipeline (no auth, no DB save). Runs the
// exact /api/assemble pipeline on a brief and writes the assembled HTML to a
// file — so you can eyeball it or feed it to spike:judge (assembled vs bespoke).
// This is the gate: does the REAL assembler output rival bespoke?
//
//   npm run assemble:smoke -- "<brief>" spike/01.assembled.html
//
// Needs GEMINI_API_KEY (recipe), TOGETHER_API_KEY (copy fill), R2 + Neon
// (section fragments) — all reachable locally for the user; blocked in the
// sandbox, so this is user-run.

import { writeFileSync } from "node:fs";
import { buildRecipe } from "../lib/assemble/recipe";
import { selectVariants } from "../lib/sections/select";
import { stitchSections } from "../lib/sections/assemble";
import { fillAssembled } from "../lib/assemble/fill";
import { normalizeBornCanonical } from "../lib/normalize";
import { ensurePageMeta } from "../lib/publish/ensure-page-meta";
import { sanitizeForPublish } from "../lib/html-engine";

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const brief = args[0];
  const outFile = args[1] ?? "spike/assembled.html";
  if (!brief || brief.trim().length < 10) {
    console.error('usage: npm run assemble:smoke -- "<brief (>=10 chars)>" [outFile]');
    process.exit(2);
  }

  console.log(`\n▸ recipe  (brief: "${brief.slice(0, 64)}${brief.length > 64 ? "…" : ""}")`);
  const recipe = await buildRecipe(brief);
  if (!recipe.ok) {
    console.error(`  recipe FAILED [${recipe.error.kind}]: ${recipe.error.message}`);
    if (recipe.raw) console.error(`  raw head: ${recipe.raw.slice(0, 200)}`);
    process.exit(1);
  }
  const t = recipe.theme;
  console.log(`  theme: mode=${t.mode} accent=${t.base.accent} bg=${t.base.bg} display=${t.fontDisplay}`);
  console.log(`  sections: ${recipe.sections.map((s) => s.type + (s.variant ? `(${s.variant})` : "")).join(" · ")}`);
  console.log(`  copy: ${recipe.copy.business_name ?? "(none)"} — "${recipe.copy.tagline_en ?? recipe.copy.tagline_es ?? ""}"`);
  if (recipe.usage) console.log(`  recipe tokens: in=${recipe.usage.inputTokens} out=${recipe.usage.outputTokens}`);

  console.log(`▸ select variants`);
  const picks = await selectVariants(recipe.sections, recipe.theme);
  console.log(`  picked (${picks.length}): ${picks.map((p) => p.slug).join(" · ")}`);
  if (picks.length < 2) {
    console.error("  FAILED: not enough sections resolved from the library");
    process.exit(1);
  }

  console.log(`▸ stitch + bind`);
  const stitched = await stitchSections(picks, recipe.theme);
  console.log(`  stitched: ${stitched.length} bytes`);

  console.log(`▸ fill copy (Kimi)`);
  const fill = await fillAssembled(stitched, recipe.copy);
  console.log(`  filled=${fill.filled} appliedOps=${fill.appliedOps}${fill.reason ? `  (${fill.reason})` : ""}`);

  const title = recipe.copy.business_name?.trim() || "Untitled page";
  const finalHtml = ensurePageMeta(normalizeBornCanonical(fill.html), { title });
  const sanitized = sanitizeForPublish(finalHtml);
  if (sanitized.html === null) {
    console.error("  FAILED: sanitizeForPublish rejected (data-slot-path leak)");
    process.exit(1);
  }

  writeFileSync(outFile, sanitized.html);
  console.log(`\n✓ wrote ${outFile}  (${sanitized.html.length} bytes)  title="${title}"`);
  console.log(`  next: open it, and/or  npm run spike:judge -- ./spike\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
