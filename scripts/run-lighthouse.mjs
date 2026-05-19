// Run Lighthouse against a list of URLs using puppeteer's bundled Chrome.
// Outputs a compact summary: category scores + top failed audits.
//
// Usage: node scripts/run-lighthouse.mjs http://localhost:3500/ ...
import puppeteer from "puppeteer";
import lighthouse from "lighthouse";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error("Pass at least one URL");
  process.exit(1);
}

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
});
const wsEndpoint = browser.wsEndpoint();
const port = Number(new URL(wsEndpoint).port);

const summaries = [];
for (const url of urls) {
  console.log(`\nAuditing ${url} ...`);
  const result = await lighthouse(
    url,
    {
      port,
      output: "json",
      logLevel: "error",
      onlyCategories: [
        "performance",
        "accessibility",
        "best-practices",
        "seo",
      ],
      formFactor: "desktop",
      screenEmulation: {
        mobile: false,
        width: 1350,
        height: 940,
        deviceScaleFactor: 1,
        disabled: false,
      },
      throttling: {
        rttMs: 40,
        throughputKbps: 10 * 1024,
        cpuSlowdownMultiplier: 1,
        requestLatencyMs: 0,
        downloadThroughputKbps: 0,
        uploadThroughputKbps: 0,
      },
      throttlingMethod: "simulate",
    },
  );
  const lhr = result.lhr;
  const slug = url.replace(/https?:\/\//, "").replace(/[\/\?#&=]+/g, "_") || "root";
  const outPath = resolve(__dirname, "..", `lighthouse-${slug}.json`);
  writeFileSync(outPath, JSON.stringify(lhr, null, 2));

  const cats = lhr.categories;
  const scores = {
    performance: Math.round((cats.performance?.score || 0) * 100),
    accessibility: Math.round((cats.accessibility?.score || 0) * 100),
    bestPractices: Math.round((cats["best-practices"]?.score || 0) * 100),
    seo: Math.round((cats.seo?.score || 0) * 100),
  };
  const failedAudits = [];
  for (const cat of Object.values(cats)) {
    for (const ref of cat.auditRefs) {
      const audit = lhr.audits[ref.id];
      if (audit.score !== null && audit.score < 1 && ref.weight > 0) {
        failedAudits.push({
          id: ref.id,
          category: cat.id,
          title: audit.title,
          score: audit.score,
          displayValue: audit.displayValue,
          weight: ref.weight,
        });
      }
    }
  }
  failedAudits.sort((a, b) => b.weight - a.weight);
  summaries.push({ url, scores, failedAudits: failedAudits.slice(0, 15) });
}

await browser.close();

console.log("\n========== SUMMARY ==========");
for (const s of summaries) {
  console.log(`\n${s.url}`);
  console.log(
    `  Performance: ${s.scores.performance}  Accessibility: ${s.scores.accessibility}  Best Practices: ${s.scores.bestPractices}  SEO: ${s.scores.seo}`,
  );
  if (s.failedAudits.length > 0) {
    console.log("  Failed audits (top 15 by weight):");
    for (const a of s.failedAudits) {
      console.log(
        `    [${a.category}] ${a.id} (w=${a.weight}, score=${a.score}) — ${a.title}${a.displayValue ? " · " + a.displayValue : ""}`,
      );
    }
  } else {
    console.log("  All audits passed.");
  }
}
