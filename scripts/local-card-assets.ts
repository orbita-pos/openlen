// One-off: generate screenshot + thumbnail + tile for the 3 hand-built premium
// templates by rendering their LOCAL html (with their local images intercepted
// in place of the R2 host the sandbox can't reach), then upload + persist.
// Mirrors capture-screenshot.ts / generate-thumbnails.ts / generate-tiles.ts.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/local-card-assets.ts

import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer";
import sharp from "sharp";
import {
  getTemplate,
  setTemplateScreenshot,
  setTemplateThumbnail,
  setTemplateTile,
} from "@/lib/templates/store";
import { getTemplateStorage } from "@/lib/storage/templates";

const argvIds = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const IDS = argvIds.length ? argvIds : ["aetherborn", "obra", "exodus", "arcana"];
const ROOT = "templates/starter";
const ASSET_RE = new RegExp(`images\\.openlen\\.com/(${IDS.join("|")})/([^?]+)$`);

async function main(): Promise<void> {
  const storage = getTemplateStorage();
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  for (const id of IDS) {
    const rec = await getTemplate(id);
    if (!rec) { console.log(`${id}: not in DB, skip`); continue; }
    const hash = rec.contentHash;
    const fileUrl = pathToFileURL(resolve(`${ROOT}/${id}.html`)).href;

    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const m = req.url().match(ASSET_RE);
      if (m) {
        const f = resolve(`${ROOT}/${m[1]}-assets/${m[2]}`);
        if (existsSync(f)) {
          const ext = extname(f).slice(1).toLowerCase();
          return req.respond({ status: 200, contentType: `image/${ext === "jpg" ? "jpeg" : ext}`, body: readFileSync(f) });
        }
        return req.respond({ status: 404 });
      }
      req.continue();
    });

    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(fileUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    await page.evaluate(() => ("fonts" in document ? (document as Document).fonts.ready : Promise.resolve()));
    await new Promise((r) => setTimeout(r, 600));

    const aboveFold = (await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1280, height: 800 } })) as Buffer;
    const full = (await page.screenshot({ type: "png", fullPage: true })) as Buffer;
    await page.close();

    // screenshot — full-page JPEG q82 (AI multimodal reference)
    const jpeg = await sharp(full).jpeg({ quality: 82 }).toBuffer();
    const ss = await storage.upload({ key: `screenshots/${id}-${hash}.jpg`, contentType: "image/jpeg", body: jpeg });
    await setTemplateScreenshot(id, ss.url);

    // thumbnail — above-the-fold 1280×800 AVIF q65 (card)
    const thumb = await sharp(aboveFold).avif({ quality: 65 }).toBuffer();
    const th = await storage.upload({ key: `thumbnails/${id}-${hash}.avif`, contentType: "image/avif", body: thumb });
    await setTemplateThumbnail(id, th.url);

    // tile — full-page downscaled to 600px wide AVIF q60 (gallery wall)
    const tile = await sharp(full).resize({ width: 600 }).avif({ quality: 60 }).toBuffer();
    const tl = await storage.upload({ key: `tiles/${id}-${hash}.avif`, contentType: "image/avif", body: tile });
    await setTemplateTile(id, tl.url);

    console.log(`${id.padEnd(11)} ✓  screenshot(${(jpeg.length/1024)|0}KB) thumb(${(thumb.length/1024)|0}KB) tile(${(tile.length/1024)|0}KB)  hash=${hash}`);
  }

  await browser.close();
  console.log("\nDONE");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
