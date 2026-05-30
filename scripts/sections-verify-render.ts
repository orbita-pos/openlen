// Gold-standard verification for the scope backfill: render the stored fragment
// (pre-fix) vs the backfilled fragment in a real headless browser and report the
// computed text color of the heading + the section's background. Confirms the
// fix turns invisible black-on-dark headings into the intended light ink.
//
// External requests (Tailwind CDN / Google Fonts) are blocked so this runs fully
// offline — the failing styles live in the inline scoped <style>, not Tailwind.
//
// Run: npm run sections:verify-render -- hero-09 logos-07
import { chromium } from "playwright";
import { getSection, getSectionHtml } from "../lib/sections/store";
import { backfillRootSelfVariants } from "../lib/sections/scope";

function backfillFragment(html: string, slug: string): string {
  return html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_f, open: string, css: string, close: string) =>
      `${open}${backfillRootSelfVariants(css, slug)}${close}`,
  );
}

function previewDoc(fragment: string, mode: string): string {
  const bg = mode === "dark" ? "#0b0b0f" : mode === "cream" ? "#f6f3ec" : "#ffffff";
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}body{background:${bg}}</style></head><body>${fragment}</body></html>`;
}

async function main() {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (ids.length === 0) {
    console.error("Usage: npm run sections:verify-render -- <id> [<id>…]");
    process.exit(2);
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Block all network so the inline-style cascade is what's measured.
  await ctx.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith("data:") || u.startsWith("about:")) return route.continue();
    return route.abort();
  });

  for (const id of ids) {
    const rec = await getSection(id);
    const raw = await getSectionHtml(id);
    if (!rec || raw === null) {
      console.log(`\n${id}: not found`);
      continue;
    }
    const fixed = backfillFragment(raw, id);

    const probe = async (fragment: string) => {
      const page = await ctx.newPage();
      await page.setContent(previewDoc(fragment, rec.mode), { waitUntil: "domcontentloaded" });
      const result = await page.evaluate((sel) => {
        const root = document.querySelector(sel) as HTMLElement | null;
        const heading = document.querySelector("h1, h2") as HTMLElement | null;
        return {
          sectionBg: root ? getComputedStyle(root).backgroundColor : "n/a",
          headingColor: heading ? getComputedStyle(heading).color : "n/a",
          headingText: (heading && heading.textContent ? heading.textContent : "").trim().slice(0, 42),
        };
      }, `[data-sec="${id}"]`);
      await page.close();
      return result;
    };

    const before = await probe(raw);
    const after = await probe(fixed);
    console.log(`\n${id} (${rec.mode})  "${after.headingText}…"`);
    console.log(`  BEFORE  heading=${before.headingColor.padEnd(22)} sectionBg=${before.sectionBg}`);
    console.log(`  AFTER   heading=${after.headingColor.padEnd(22)} sectionBg=${after.sectionBg}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
