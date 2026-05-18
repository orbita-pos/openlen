import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { callGeminiVision } from "../lib/style-match/vision";
import type { ExtractedTokens } from "../lib/style-match/extract/types";

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: tsx scripts/test-vision.ts <hostname-slug>");
    console.error("       (looks for .style-match-test/<slug>.jpg + .tokens.json)");
    process.exit(1);
  }

  const dir = join(process.cwd(), ".style-match-test");
  const jpgPath = join(dir, `${slug}.jpg`);
  const tokensPath = join(dir, `${slug}.tokens.json`);

  if (!existsSync(jpgPath) || !existsSync(tokensPath)) {
    console.error(`Missing artifacts at ${jpgPath} and/or ${tokensPath}`);
    console.error(`Run: npx tsx scripts/test-puppeteer.ts <url>  first to generate them.`);
    process.exit(1);
  }

  const screenshot = readFileSync(jpgPath);
  const tokens = JSON.parse(readFileSync(tokensPath, "utf-8")) as ExtractedTokens;

  console.log(`\n[gemini-vision] Analyzing: ${slug}`);
  console.log(`  screenshot: ${(screenshot.byteLength / 1024).toFixed(1)} KB`);
  console.log(`  tokens primary: ${tokens.color.primary?.hex ?? "—"}\n`);

  const result = await callGeminiVision({ tokens, screenshot });
  console.log(`Latency: ${result.durationMs}ms`);
  if (result.usage) {
    console.log(`Tokens used: input=${result.usage.inputTokens}  output=${result.usage.outputTokens}`);
  }

  if (result.error) {
    console.log(`\nERROR (${result.error.kind}): ${result.error.message}`);
    console.log(`\nRaw model output (${result.raw?.length ?? 0} chars):`);
    console.log(result.raw ? result.raw.slice(0, 3000) : "(none)");
    console.log(`\n[end of raw output]`);
    process.exit(1);
  }

  if (!result.analysis) {
    console.log(`\nNo analysis returned (and no error). Raw:`);
    console.log(result.raw?.slice(0, 1000) ?? "(empty)");
    process.exit(1);
  }

  const a = result.analysis;
  console.log(`\n=== GEMINI VISION ANALYSIS ===\n`);
  console.log(`Vibe summary:    ${a.vibe_summary}`);
  console.log(`Design language: ${a.design_language}  (conf=${a.design_language_confidence.toFixed(2)})`);
  console.log(`Hierarchy:       ${a.visual_hierarchy_clarity}/5`);
  console.log(`Whitespace:      ${a.whitespace_use}`);
  console.log(`Motion implied:  ${a.motion_implied}`);
  console.log(`Type personality: ${a.type_personality}`);
  console.log(`Shadow intensity: ${a.shadow_intensity}`);
  console.log(`Radius personality: ${a.radius_personality}`);
  console.log(`\nColor roles:`);
  for (const [role, hex] of Object.entries(a.color_roles)) {
    console.log(`  ${role.padEnd(20)} ${hex}`);
  }
  console.log(`\nDefining choices:`);
  for (const choice of a.top_3_design_choices_that_define_this_page) {
    console.log(`  • ${choice}`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
