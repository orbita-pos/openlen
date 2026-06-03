// Render every marketing/templates/<name>.<W>x<H>.html → marketing/promo/<name>.png
// (deviceScaleFactor 2 for crisp 2x social assets). Waits for webfonts.
import puppeteer from "puppeteer";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SRC = "marketing/templates";
const OUT = "marketing/promo";
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter((f) => f.endsWith(".html"));
if (!files.length) { console.log("no templates"); process.exit(0); }

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let ok = 0;
for (const f of files) {
  const m = f.match(/\.(\d+)x(\d+)\.html$/);
  if (!m) { console.log("skip (no .WxH):", f); continue; }
  const w = +m[1], h = +m[2];
  const name = f.replace(/\.\d+x\d+\.html$/, "");
  const html = readFileSync(join(SRC, f), "utf8");
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
  try { await page.evaluate(() => document.fonts.ready); } catch {}
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: join(OUT, name + ".png"), clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  console.log("✓", name + ".png", `${w}x${h}`);
  ok++;
}
await browser.close();
console.log(`\nrendered ${ok} image(s) → ${OUT}/`);
