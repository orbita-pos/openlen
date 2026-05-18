import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { extractTokens, fetchPuppeteer } from "../lib/style-match";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: tsx scripts/test-puppeteer.ts <url>");
    process.exit(1);
  }

  console.log(`\n[tier-2] Rendering: ${url}\n`);
  const t0 = Date.now();
  const out = await fetchPuppeteer({ url });
  const totalMs = Date.now() - t0;
  console.log(`Render + sweep: ${totalMs}ms\n`);

  if (!out.ok) {
    console.log("FAIL:", JSON.stringify(out.error, null, 2));
    process.exit(1);
  }
  const r = out.value;

  console.log(`Hostname:        ${r.hostname}`);
  console.log(`Final URL:       ${r.finalUrl}`);
  console.log(`HTML size:       ${(r.sizeBytes / 1024).toFixed(1)} KB`);
  console.log(`Screenshot:      ${r.screenshot ? `${(r.screenshot.byteLength / 1024).toFixed(1)} KB` : "—"}`);
  console.log(`Document HxW:    ${r.computedStyles?.documentHeight} x ${r.computedStyles?.documentWidth}`);
  console.log(`Elements:        ${r.computedStyles?.elements.length}`);

  const tExtract = Date.now();
  const tokens = extractTokens(r);
  const extractMs = Date.now() - tExtract;

  console.log(`\nToken extraction: ${extractMs}ms\n`);

  console.log("=== EXTRACTED TOKENS ===\n");

  console.log("COLORS");
  console.log(`  Polarity:  ${tokens.color.polarity}`);
  if (tokens.color.primary) {
    console.log(`  Primary:   ${tokens.color.primary.hex}  (chroma=${tokens.color.primary.oklch.c.toFixed(3)}, ${tokens.color.primary.occurrenceCount} uses)`);
  } else {
    console.log(`  Primary:   — (no strong brand signal detected)`);
  }
  if (tokens.color.accents.length > 0) {
    console.log(`  Accents:`);
    for (const a of tokens.color.accents) {
      console.log(`    ${a.hex}  (chroma=${a.oklch.c.toFixed(3)}, ${a.occurrenceCount} uses)`);
    }
  }
  if (tokens.color.neutrals.length > 0) {
    console.log(`  Neutrals:`);
    for (const n of tokens.color.neutrals) {
      console.log(`    ${n.step.padEnd(4)} ${n.entry.hex}  L=${n.entry.oklch.l.toFixed(2)}`);
    }
  }

  console.log("\nTYPOGRAPHY");
  console.log(`  Primary:  ${tokens.typography.family.primary}`);
  if (tokens.typography.family.display) console.log(`  Display:  ${tokens.typography.family.display}`);
  if (tokens.typography.family.mono) console.log(`  Mono:     ${tokens.typography.family.mono}`);
  console.log(`  Sizes:    [${tokens.typography.size.detected.join(", ")}]px`);
  if (tokens.typography.size.ratio !== null) {
    console.log(`  Ratio:    ${tokens.typography.size.ratio.toFixed(3)}  (${tokens.typography.size.ratioMatch})`);
  }
  console.log(`  Weights:  ${tokens.typography.weights.map((w) => `${w.value} (${w.label})`).join(", ")}`);

  console.log("\nSPACING");
  console.log(`  Base:     ${tokens.spacing.base}px`);
  console.log(`  Detected top 20: [${tokens.spacing.detectedValues.slice(0, 20).join(", ")}]px`);

  console.log("\nRADIUS");
  console.log(`  Personality: ${tokens.radius.personality}`);
  console.log(`  Distinct:    [${tokens.radius.distinctValues.slice(0, 12).join(", ")}]px`);
  console.log(`  Scale:       ${Object.entries(tokens.radius.scale).map(([k, v]) => `${k}=${v}`).join(", ")}`);

  console.log("\nSHADOW");
  console.log(`  Personality: ${tokens.shadow.personality}`);
  console.log(`  Distinct:    ${tokens.shadow.distinct.length}`);
  for (const s of tokens.shadow.distinct.slice(0, 3)) {
    console.log(`    layers=${s.layerCount}  maxBlur=${s.maxBlur}  colored=${s.hasColored}  raw="${s.raw.slice(0, 80)}${s.raw.length > 80 ? "…" : ""}"`);
  }

  const outDir = join(process.cwd(), ".style-match-test");
  mkdirSync(outDir, { recursive: true });
  const slug = r.hostname.replace(/\W+/g, "-");
  if (r.screenshot) {
    writeFileSync(join(outDir, `${slug}.jpg`), r.screenshot);
  }
  writeFileSync(join(outDir, `${slug}.tokens.json`), JSON.stringify(tokens, null, 2));
  console.log(`\nSaved: .style-match-test/${slug}.tokens.json (+ ${slug}.jpg)\n`);
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
