// Generate AVIF thumbnail previews for every template via headless Chrome.
//
// The marketing TemplateCard renders `thumbnailUrl` as a static <img> (~10×
// lighter than a live iframe). This captures the 1280×800 FOLD of each
// template.
//
// Scroll-reveal handling (v2 — mirrors generate-tiles.ts). OpenLen templates
// start the hero + sections at opacity:0 and reveal them on scroll (`.reveal`
// → an IntersectionObserver adds `.in`, fading in over ~0.85s). The old naive
// capture (load + 250ms) froze the hero MID-FADE → faint, washed-out
// thumbnails. v2 fixes that three ways:
//   • emulate prefers-reduced-motion:reduce — templates honor it
//     (`@media(reduce){.reveal{opacity:1}}`) so reveals render statically;
//   • inject a stylesheet that snaps every animation/transition to its final
//     FORWARDS state (covers templates that ignore reduced-motion + scroll-
//     driven view() timelines);
//   • autoscroll to fire any IntersectionObserver reveals, then return to top.
//
// THUMB_VERSION is part of the object key, so a bump regenerates EVERY
// thumbnail on the next run (no --force) and mints a fresh URL the year-
// immutable CDN cache can't shadow.
//
// Strategy per template:
//   1. latest contentHash from DB; skip if thumbnailUrl already encodes
//      contentHash + THUMB_VERSION (idempotent; --force re-runs all)
//   2. Puppeteer at storageUrl with reduced-motion emulated
//   3. networkidle0 + document.fonts.ready + freeze stylesheet + autoscroll
//   4. Screenshot 1280×800 PNG → sharp → AVIF q65
//   5. Upload to thumbnails/<id>-<contentHash>-<THUMB_VERSION>.avif; persist URL
//
// Concurrency: 3 in parallel. ~6-8 min for 165 templates.

import { eq } from "drizzle-orm";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { db, schema } from "@/lib/db";
import { processImage } from "@/lib/images";
import { setTemplateThumbnail } from "@/lib/templates/store";
import { getTemplateStorage } from "@/lib/storage/templates";

const VIEWPORT = { width: 1280, height: 800 };
const CONCURRENCY = 3;
const PAGE_TIMEOUT_MS = 30_000;
const POST_LOAD_SETTLE_MS = 250;
// Bump when the capture logic changes. v1 = naive fold capture (froze reveals
// mid-fade); v2 = reduced-motion + animation-freeze + autoscroll. A bump
// regenerates every thumbnail on the next run and changes the URL so the
// immutable CDN cache serves the fresh image.
const THUMB_VERSION = "v2";

interface Row {
  id: string;
  storageUrl: string;
  contentHash: string;
  thumbnailUrl: string | null;
}

async function listTargets(force: boolean): Promise<Row[]> {
  const rows = await db
    .select({
      id: schema.templates.id,
      storageUrl: schema.templates.storageUrl,
      contentHash: schema.templates.contentHash,
      thumbnailUrl: schema.templates.thumbnailUrl,
    })
    .from(schema.templates)
    .where(eq(schema.templates.status, "published"));

  if (force) return rows;
  // Skip rows whose thumbnailUrl already encodes the current contentHash AND
  // thumbnail version — a version bump (capture-logic change) regenerates all.
  return rows.filter(
    (r) =>
      !r.thumbnailUrl ||
      !r.thumbnailUrl.includes(`${r.id}-${r.contentHash}-${THUMB_VERSION}`),
  );
}

// Scroll top→bottom so IntersectionObserver-based reveals fire, then back to
// top. Re-reads scrollHeight each tick (lazy growth) and caps the loop.
async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let y = 0;
      let ticks = 0;
      const timer = setInterval(() => {
        const max = document.body.scrollHeight;
        window.scrollBy(0, 500);
        y += 500;
        ticks += 1;
        if (y >= max || ticks > 200) {
          clearInterval(timer);
          resolve();
        }
      }, 50);
    });
    window.scrollTo(0, 0);
  });
}

async function captureOne(
  browser: Browser,
  row: Row,
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  const page = await browser.newPage();
  try {
    await page.setViewport(VIEWPORT);
    // Templates honor reduced-motion → their `.reveal` elements render at
    // opacity:1 statically instead of fading in on scroll.
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    await page.goto(row.storageUrl, {
      waitUntil: "networkidle0",
      timeout: PAGE_TIMEOUT_MS,
    });
    // Wait for web fonts to actually render — otherwise the screenshot captures
    // the FOUT fallback and the thumbnail looks wrong.
    await page.evaluate(() =>
      "fonts" in document ? document.fonts.ready : Promise.resolve(),
    );
    await new Promise((resolve) => setTimeout(resolve, POST_LOAD_SETTLE_MS));

    // Snap every animation/transition to its final FORWARDS state so a hero
    // reveal can't be frozen mid-fade. animation-timeline:auto converts scroll-
    // driven (view()) timelines to time-based so they complete instantly.
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation-timeline:auto!important;animation-range:normal!important;animation-duration:.001s!important;animation-delay:0s!important;animation-fill-mode:forwards!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}",
    });
    await autoScroll(page);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const pngBuffer = (await page.screenshot({
      type: "png",
      fullPage: false,
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    })) as Buffer;

    // AVIF over WebP — ~30% smaller at equivalent quality. width:0 keeps the
    // screenshot's intrinsic 1280×800.
    const { variants } = await processImage({
      input: pngBuffer,
      variants: [{ width: 0, format: "avif", quality: 65 }],
      autoOrient: false,
      withoutEnlargement: true,
    });
    const avifBuffer = variants[0].bytes;

    const key = `thumbnails/${row.id}-${row.contentHash}-${THUMB_VERSION}.avif`;
    const storage = getTemplateStorage();
    const uploaded = await storage.upload({
      key,
      contentType: "image/avif",
      body: avifBuffer,
    });

    await setTemplateThumbnail(row.id, uploaded.url);

    // Self-clean: drop the thumbnail this row previously pointed at (old
    // contentHash or version) so regenerations update-in-place instead of
    // orphaning objects in R2. Best-effort; never delete the one just written.
    if (row.thumbnailUrl) {
      const i = row.thumbnailUrl.indexOf("thumbnails/");
      const oldKey = i >= 0 ? row.thumbnailUrl.slice(i) : "";
      if (oldKey.startsWith("thumbnails/") && oldKey !== key) {
        await storage.delete(oldKey).catch(() => {});
      }
    }

    return { ok: true, url: uploaded.url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  } finally {
    await page.close();
  }
}

async function processInChunks(
  browser: Browser,
  rows: Row[],
): Promise<{ ok: number; failed: { id: string; reason: string }[] }> {
  let ok = 0;
  const failed: { id: string; reason: string }[] = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (row) => {
        const t0 = Date.now();
        const res = await captureOne(browser, row);
        const ms = Date.now() - t0;
        if (res.ok) {
          // eslint-disable-next-line no-console
          console.log(`  ✓ ${row.id.padEnd(22)} ${ms}ms`);
          ok++;
        } else {
          // eslint-disable-next-line no-console
          console.log(`  ✗ ${row.id.padEnd(22)} ${ms}ms — ${res.reason}`);
          failed.push({ id: row.id, reason: res.reason });
        }
      }),
    );
  }
  return { ok, failed };
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const targets = await listTargets(force);
  if (targets.length === 0) {
    // eslint-disable-next-line no-console
    console.log("All templates already have up-to-date thumbnails. Nothing to do.");
    return;
  }
  // eslint-disable-next-line no-console
  console.log(
    `Generating thumbnails for ${targets.length} templates (concurrency ${CONCURRENCY})…\n`,
  );

  // Prefer the system Chromium / Edge / Chrome at PUPPETEER_EXECUTABLE_PATH
  // (matches the Hetzner box convention); fall back to Puppeteer's bundled
  // Chrome when no path is provided.
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    // Heavy templates (canvas/WebGL) can blow past the default 180s CDP timeout
    // on captureScreenshot — give them room.
    protocolTimeout: 300_000,
  });

  const t0 = Date.now();
  try {
    const { ok, failed } = await processInChunks(browser, targets);
    const total = ((Date.now() - t0) / 1000).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(`\nDone. ok=${ok} failed=${failed.length} (${total}s)`);
    if (failed.length > 0) {
      // eslint-disable-next-line no-console
      console.log("\nFailures:");
      for (const f of failed) {
        // eslint-disable-next-line no-console
        console.log(`  ${f.id} — ${f.reason}`);
      }
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
