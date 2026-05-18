import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyStyleMatch, callGeminiVision } from "../lib/style-match";
import type { ExtractedTokens } from "../lib/style-match/extract/types";
import type { VisionAnalysis } from "../lib/style-match/vision/schema";
import { VisionAnalysisSchema } from "../lib/style-match/vision/schema";

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SampleCo — Style Match before</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-white text-zinc-900 antialiased">
  <header class="px-6 py-4 border-b border-gray-200">
    <div class="max-w-6xl mx-auto flex items-center justify-between">
      <a href="#" class="text-xl font-bold text-zinc-900">SampleCo</a>
      <nav class="flex items-center gap-6 text-sm">
        <a href="#" class="text-zinc-500 hover:text-zinc-900">Features</a>
        <a href="#" class="text-zinc-500 hover:text-zinc-900">Pricing</a>
        <a href="#" class="text-zinc-500 hover:text-zinc-900">Docs</a>
        <button class="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-md shadow">Get started</button>
      </nav>
    </div>
  </header>

  <section class="px-6 py-24">
    <div class="max-w-3xl mx-auto text-center">
      <p class="text-sm font-medium text-blue-600 mb-3">New · Style Match preview</p>
      <h1 class="text-5xl font-bold text-zinc-900 mb-4 leading-tight">A landing page that adapts to your taste.</h1>
      <p class="text-lg text-zinc-500 mb-8 max-w-2xl mx-auto">Paste any URL and your page gets its visual language — colors, fonts, spacing — without changing your content.</p>
      <div class="flex items-center justify-center gap-3">
        <button class="bg-blue-600 text-white font-medium px-6 py-3 rounded-md shadow-md">Try it free</button>
        <button class="bg-white text-zinc-900 font-medium px-6 py-3 rounded-md border border-gray-200">See an example</button>
      </div>
    </div>
  </section>

  <section class="px-6 py-20 bg-zinc-50">
    <div class="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
      <div class="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <h3 class="font-semibold text-zinc-900 mb-2">Token extraction</h3>
        <p class="text-sm text-zinc-500">Colors, fonts, spacing scale, radius, shadows — pulled from the target URL.</p>
      </div>
      <div class="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <h3 class="font-semibold text-zinc-900 mb-2">Vision analysis</h3>
        <p class="text-sm text-zinc-500">Gemini reads the screenshot to identify which color plays which role.</p>
      </div>
      <div class="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <h3 class="font-semibold text-zinc-900 mb-2">Apply to your page</h3>
        <p class="text-sm text-zinc-500">A single stylesheet override — your content stays, the feel changes.</p>
      </div>
    </div>
  </section>

  <footer class="px-6 py-8 border-t border-gray-200">
    <div class="max-w-6xl mx-auto text-sm text-zinc-500">© 2026 SampleCo</div>
  </footer>
</body>
</html>`;

async function loadOrFetchVision(
  slug: string,
  dir: string,
  tokens: ExtractedTokens,
  screenshot: Buffer,
): Promise<VisionAnalysis> {
  const visionPath = join(dir, `${slug}.vision.json`);
  if (existsSync(visionPath)) {
    const cached = JSON.parse(readFileSync(visionPath, "utf-8"));
    const parsed = VisionAnalysisSchema.safeParse(cached);
    if (parsed.success) {
      console.log(`  vision: loaded from cache (${slug}.vision.json)`);
      return parsed.data;
    }
    console.log(`  vision: cache invalid, re-fetching from Gemini`);
  }
  console.log(`  vision: calling Gemini (will cache to ${slug}.vision.json)`);
  const result = await callGeminiVision({ tokens, screenshot });
  if (!result.analysis) {
    throw new Error(`Gemini vision failed: ${JSON.stringify(result.error)}`);
  }
  writeFileSync(visionPath, JSON.stringify(result.analysis, null, 2));
  return result.analysis;
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: tsx scripts/test-apply.ts <hostname-slug>");
    console.error("       (run test-puppeteer.ts <url> first to produce artifacts)");
    process.exit(1);
  }

  const dir = join(process.cwd(), ".style-match-test");
  const tokensPath = join(dir, `${slug}.tokens.json`);
  const jpgPath = join(dir, `${slug}.jpg`);
  if (!existsSync(tokensPath) || !existsSync(jpgPath)) {
    console.error(`Missing ${tokensPath} or ${jpgPath}. Run test-puppeteer.ts <url> first.`);
    process.exit(1);
  }

  console.log(`\n[apply] Style Match against sample landing using ${slug}\n`);

  const tokens = JSON.parse(readFileSync(tokensPath, "utf-8")) as ExtractedTokens;
  const screenshot = readFileSync(jpgPath);
  const vision = await loadOrFetchVision(slug, dir, tokens, screenshot);

  console.log(`  source primary token: ${tokens.color.primary?.hex ?? "—"}`);
  console.log(`  vision accent role:   ${vision.color_roles.accent}`);
  console.log(`  vision background:    ${vision.color_roles.background}`);
  console.log(`  vision foreground:    ${vision.color_roles.foreground_primary}`);
  console.log(`  vision font:          ${tokens.typography.family.primary}`);
  console.log(`  design language:      ${vision.design_language}`);

  const beforePath = join(dir, `apply-before.html`);
  const afterPath = join(dir, `${slug}-applied.html`);

  if (!existsSync(beforePath)) {
    writeFileSync(beforePath, SAMPLE_HTML);
  }
  const result = applyStyleMatch(SAMPLE_HTML, tokens, vision);
  writeFileSync(afterPath, result.html);

  console.log(`\n  injected font: ${result.injectedFont ?? "(system fallback)"}`);
  if (result.warnings.length > 0) {
    console.log(`  warnings:`);
    for (const w of result.warnings) console.log(`    • ${w}`);
  }

  const fileUrl = (path: string) =>
    "file:///" + path.replace(/\\/g, "/").replace(/^([A-Z]):/, (_m, d: string) => d.toLowerCase() + ":");
  console.log(`\nOpen in browser to compare:`);
  console.log(`  BEFORE:  ${fileUrl(beforePath)}`);
  console.log(`  AFTER:   ${fileUrl(afterPath)}`);
  console.log();
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
