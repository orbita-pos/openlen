// Validation harness for the CURATION path (no auth/DB save). Cheap model picks
// ONE whole template + invents copy → fill the copy → write the HTML to a file
// for spike:judge (curated vs bespoke). The clean alternative to stitching:
// a curated template is already a coherent, centred page — no seams.
//
//   npm run curate:smoke -- "<brief>" spike/01.curated.html
//
// Needs GEMINI_API_KEY (pick + fill) + R2 + Neon (templates). User-run.

import { writeFileSync } from "node:fs";
import { listTemplates, getTemplateHtml } from "../lib/templates/store";
import { pickTemplate, pickWeighted, type TemplateCatalogItem } from "../lib/curate/pick-template";
import { fillAssembled } from "../lib/assemble/fill";
import { normalizeBornCanonical } from "../lib/normalize";
import { ensurePageMeta } from "../lib/publish/ensure-page-meta";
import { sanitizeForPublish } from "../lib/html-engine";

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const brief = args[0];
  const outFile = args[1] ?? "spike/curated.html";
  if (!brief || brief.trim().length < 10) {
    console.error('usage: npm run curate:smoke -- "<brief (>=10 chars)>" [outFile]');
    process.exit(2);
  }

  console.log(`\n▸ catalog`);
  const templates = await listTemplates({ status: "published" });
  console.log(`  ${templates.length} published templates`);
  if (templates.length === 0) {
    console.error("  FAILED: no published templates");
    process.exit(1);
  }
  const catalog: TemplateCatalogItem[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    family: t.family,
    mode: t.mode,
    pitch: t.pitch,
    description: t.description,
  }));

  console.log(`▸ pick template + invent copy  (brief: "${brief.slice(0, 64)}${brief.length > 64 ? "…" : ""}")`);
  const pick = await pickTemplate(brief, catalog);
  if (!pick.ok) {
    console.error(`  pick FAILED [${pick.error.kind}]: ${pick.error.message}`);
    if (pick.raw) console.error(`  raw head: ${pick.raw.slice(0, 200)}`);
    process.exit(1);
  }
  const chosenId = pickWeighted(pick.templateIds);
  const chosen = templates.find((t) => t.id === chosenId)!;
  console.log(`  candidates: [${pick.templateIds.join(", ")}] → picked: ${chosenId} (${chosen.name} · ${chosen.family} · ${chosen.mode})`);
  console.log(`  copy: ${pick.copy.business_name ?? "(none)"} — "${pick.copy.tagline_en ?? pick.copy.tagline_es ?? ""}"`);
  if (pick.usage) console.log(`  pick tokens: in=${pick.usage.inputTokens} out=${pick.usage.outputTokens}`);

  console.log(`▸ load template HTML`);
  const templateHtml = await getTemplateHtml(chosenId);
  if (templateHtml === null) {
    console.error("  FAILED: template HTML unavailable");
    process.exit(1);
  }
  console.log(`  ${templateHtml.length} bytes`);

  console.log(`▸ fill copy (Gemini)`);
  const fill = await fillAssembled(templateHtml, pick.copy);
  console.log(`  filled=${fill.filled} appliedOps=${fill.appliedOps}${fill.reason ? `  (${fill.reason})` : ""}`);

  const title = pick.copy.business_name?.trim() || chosen.name;
  const finalHtml = ensurePageMeta(normalizeBornCanonical(fill.html), { title });
  const sanitized = sanitizeForPublish(finalHtml);
  if (sanitized.html === null) {
    console.error("  FAILED: sanitizeForPublish rejected (data-slot-path leak)");
    process.exit(1);
  }

  writeFileSync(outFile, sanitized.html);
  console.log(`\n✓ wrote ${outFile}  (${sanitized.html.length} bytes)  template="${chosenId}"  title="${title}"`);
  console.log(`  next: open it, and/or  npm run spike:judge -- ./spike\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
