import puppeteer from "puppeteer";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, basename, extname } from "node:path";
import { findChromeExecutable } from "../lib/style-match/scrape/find-browser";

const VIEWPORTS = [
  { name: "mobile-sm", width: 360, height: 800 },
  { name: "mobile-lg", width: 414, height: 896 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

interface ViewportAudit {
  name: string;
  width: number;
  scrollWidth: number;
  scrollHeight: number;
  overflowPx: number;
  smallTouchTargets: number;
  tinyFonts: number;
  ok: boolean;
}

async function auditFile(
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
  filepath: string,
  summary: Array<{ name: string; results: ViewportAudit[] }>,
): Promise<void> {
  const absolute = resolve(filepath);
  const fileUrl = "file:///" + absolute.replace(/\\/g, "/");
  const name = basename(filepath, extname(filepath));
  const outDir = join(".style-match-test", "mobile-audit", name);
  mkdirSync(outDir, { recursive: true });

  console.log(`\n[mobile-audit] ${name}`);

  const results: ViewportAudit[] = [];
  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 2 });
      await page.goto(fileUrl, { waitUntil: "networkidle2", timeout: 20_000 });
      await new Promise((r) => setTimeout(r, 1500));

      const audit = await page.evaluate(() => {
        const doc = document.documentElement;
        const interactiveSelector =
          "button, a[href], [role='button'], [type='submit'], [type='button'], input, textarea, select";
        const interactives = Array.from(document.querySelectorAll(interactiveSelector));
        let smallTouchTargets = 0;
        for (const el of interactives) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.width < 44 || r.height < 44) smallTouchTargets += 1;
        }
        const textNodes = Array.from(document.querySelectorAll("p, span, li, dt, dd, label, small"));
        let tinyFonts = 0;
        for (const el of textNodes) {
          const text = (el.textContent ?? "").trim();
          if (text.length === 0) continue;
          const size = parseFloat(window.getComputedStyle(el as Element).fontSize);
          if (!Number.isNaN(size) && size > 0 && size < 14) tinyFonts += 1;
        }
        return {
          scrollWidth: doc.scrollWidth,
          scrollHeight: doc.scrollHeight,
          viewportWidth: window.innerWidth,
          smallTouchTargets,
          tinyFonts,
        };
      });

      const overflowPx = Math.max(0, audit.scrollWidth - audit.viewportWidth);
      const ok = overflowPx <= 1 && (vp.width > 414 || audit.smallTouchTargets === 0);

      const sshot = await page.screenshot({ type: "jpeg", quality: 80, fullPage: true });
      writeFileSync(join(outDir, `${vp.name}.jpg`), sshot);
      results.push({
        name: vp.name,
        width: vp.width,
        scrollWidth: audit.scrollWidth,
        scrollHeight: audit.scrollHeight,
        overflowPx,
        smallTouchTargets: audit.smallTouchTargets,
        tinyFonts: audit.tinyFonts,
        ok,
      });

      const flag = ok ? "OK   " : overflowPx > 1 ? `OVERF` : `WARN `;
      console.log(
        `  ${flag} ${vp.name.padEnd(11)} ${vp.width.toString().padStart(4)}px  ` +
          `doc=${audit.scrollWidth}x${audit.scrollHeight}  ` +
          `overflow=${overflowPx}px  ` +
          `smallBtn=${audit.smallTouchTargets}  ` +
          `tinyFont=${audit.tinyFonts}`,
      );
      await page.close();
    }
  } finally {
    // Browser is shared across files; main() closes it.
  }

  writeFileSync(
    join(outDir, "audit.json"),
    JSON.stringify({ name, results }, null, 2),
  );
  summary.push({ name, results });
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: tsx scripts/mobile-audit.ts <path-to-html> [more...]");
    process.exit(1);
  }
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: findChromeExecutable(),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const summary: Array<{ name: string; results: ViewportAudit[] }> = [];
  try {
    for (const f of files) {
      await auditFile(browser, f, summary);
    }
  } finally {
    await browser.close();
  }

  if (summary.length > 1) {
    console.log(`\n\n=== SUMMARY (${summary.length} templates) ===`);
    console.log("Name".padEnd(14) + " | " + "Overflow@360".padEnd(13) + " | " + "SmallBtn@360".padEnd(13) + " | " + "TinyFont@360".padEnd(13) + " | " + "Status");
    console.log("-".repeat(85));
    for (const s of summary) {
      const sm = s.results.find((r) => r.name === "mobile-sm");
      if (!sm) continue;
      const status = sm.overflowPx > 1 ? "❌ OVERFLOW" : sm.smallTouchTargets > 20 ? "⚠️  TOUCH" : sm.tinyFonts > 50 ? "⚠️  FONTS" : "✓ OK";
      console.log(
        s.name.padEnd(14) +
          " | " +
          (sm.overflowPx + "px").padEnd(13) +
          " | " +
          sm.smallTouchTargets.toString().padEnd(13) +
          " | " +
          sm.tinyFonts.toString().padEnd(13) +
          " | " +
          status,
      );
    }
  }
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});
