// Generate small, right-sized AVIF gallery TILES for every template.
//
// Why a separate asset from thumbnailUrl: the thumbnail is a 1280×800 AVIF —
// great as a source, but ~10× the bytes a ~360-600px card actually needs.
// Framer's wall is smooth because each tile ships an image sized to its box.
// This produces a ~600px-wide AVIF (q60) so a gallery wall / the workspace
// picker can render dozens of static <img>s without jank instead of live
// iframes or oversized thumbnails.
//
// Strategy (mirrors generate-thumbnails.ts, but FULL-PAGE):
//   1. Look up the latest contentHash from DB
//   2. Skip if tileUrl already encodes that contentHash (idempotent; --force re-runs)
//   3. Full-page screenshot (hero + sections, not just the fold) so the tile
//      can be cropped to tall PORTRAIT mosaic windows (9:16, 2:3) showing real
//      page content instead of a sliver. Cards still object-cover the tile's
//      TOP into their 16:10 box, so they keep showing the fold — backward
//      compatible. Captured at a 1280×800 viewport so min-h-screen heroes
//      render at fold height and real sections sit below them.
//   4. processImage → downscale to 600px wide AVIF q60 (Lanczos3, aspect-
//      preserving). The tile stays light (~tens of KB) despite being tall.
//   5. Upload to `tiles/<id>-<contentHash>.avif`
//   6. Persist tileUrl in DB
//
// Concurrency 3 — same memory reasoning as the thumbnail script.

import { eq } from "drizzle-orm";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { db, schema } from "@/lib/db";
import { processImage } from "@/lib/images";
import { setTemplateTile } from "@/lib/templates/store";
import { getTemplateStorage } from "@/lib/storage/templates";

// 1280×800 viewport so min-h-screen heroes render at fold height; fullPage
// capture then includes the sections below them.
const VIEWPORT = { width: 1280, height: 800 };
const TILE_WIDTH = 600;
const TILE_QUALITY = 60;
// Bump when the capture/encode logic changes (e.g. fold → full-page). R2
// objects are immutable-cached for a year, so reusing the same key would
// serve the STALE tile from the CDN. A version in the key forces a fresh URL,
// and the idempotency check below regenerates everything on a bump — no
// --force needed. v1 = fold clip; v2 = full-page; v3 = full-page + autoscroll
// & animation-freeze so scroll-reveal sections aren't captured blank.
const TILE_VERSION = "v3";
const CONCURRENCY = 3;
const PAGE_TIMEOUT_MS = 30_000;
const POST_LOAD_SETTLE_MS = 250;

interface Row {
  id: string;
  storageUrl: string;
  contentHash: string;
  tileUrl: string | null;
}

async function listTargets(force: boolean): Promise<Row[]> {
  const rows = await db
    .select({
      id: schema.templates.id,
      storageUrl: schema.templates.storageUrl,
      contentHash: schema.templates.contentHash,
      tileUrl: schema.templates.tileUrl,
    })
    .from(schema.templates)
    .where(eq(schema.templates.status, "published"));

  if (force) return rows;
  // Skip rows whose tileUrl already encodes the current contentHash AND tile
  // version — a version bump (capture-logic change) regenerates everything.
  return rows.filter(
    (r) =>
      !r.tileUrl ||
      !r.tileUrl.includes(`${r.id}-${r.contentHash}-${TILE_VERSION}`),
  );
}

// Scroll the whole page top→bottom so IntersectionObserver-based reveal
// animations fire, then return to the top. Re-reads scrollHeight each tick so
// lazy growth is covered; capped so a page that grows on scroll can't loop.
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
    // Ask reveal scripts that honor it to render statically (some do, some
    // don't — harmless either way; pairs with autoscroll + the freeze
    // stylesheet below to maximize how much renders for the capture).
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    await page.goto(row.storageUrl, {
      waitUntil: "networkidle0",
      timeout: PAGE_TIMEOUT_MS,
    });
    await page.evaluate(() =>
      "fonts" in document ? document.fonts.ready : Promise.resolve(),
    );
    await new Promise((resolve) => setTimeout(resolve, POST_LOAD_SETTLE_MS));

    // Scroll-reveal handling. Many templates start sections at opacity:0 and
    // reveal them on scroll — via IntersectionObserver (autoscroll fires it,
    // e.g. heron) or via a CSS keyframe fade with a delay (the injected style
    // snaps every animation/transition to its final FORWARDS state, e.g.
    // lumen). Without this, a fullPage capture grabs those sections BLANK.
    await page.addStyleTag({
      // animation-timeline:auto converts scroll-driven CSS animations (view()
      // timelines, e.g. lumen's faint-text reveals) to time-based so they
      // complete instantly instead of reverting when we scroll back to top.
      content:
        "*,*::before,*::after{animation-timeline:auto!important;animation-range:normal!important;animation-duration:.001s!important;animation-delay:0s!important;animation-fill-mode:forwards!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}",
    });
    await autoScroll(page);
    await new Promise((resolve) => setTimeout(resolve, 400));

    const pngBuffer = (await page.screenshot({
      type: "png",
      fullPage: true,
    })) as Buffer;

    // Downscale to TILE_WIDTH (Lanczos3, aspect-preserving) + AVIF q60.
    const { variants } = await processImage({
      input: pngBuffer,
      variants: [{ width: TILE_WIDTH, format: "avif", quality: TILE_QUALITY }],
      autoOrient: false,
      withoutEnlargement: true,
    });
    const avifBuffer = variants[0].bytes;

    const key = `tiles/${row.id}-${row.contentHash}-${TILE_VERSION}.avif`;
    const storage = getTemplateStorage();
    const uploaded = await storage.upload({
      key,
      contentType: "image/avif",
      body: avifBuffer,
    });

    await setTemplateTile(row.id, uploaded.url);

    // Self-clean: drop the tile this row previously pointed at (old contentHash
    // or old TILE_VERSION) so regenerations update-in-place instead of piling
    // orphans in R2. The key is the URL's `tiles/...` tail (works for the R2
    // public URL and the dev FS path). Best-effort — a failed delete must not
    // fail the tile, and we never delete the object we just wrote (oldKey===key).
    if (row.tileUrl) {
      const oldKey = row.tileUrl.slice(row.tileUrl.indexOf("tiles/"));
      if (oldKey.startsWith("tiles/") && oldKey !== key) {
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
    console.log("All templates already have up-to-date tiles. Nothing to do.");
    return;
  }
  // eslint-disable-next-line no-console
  console.log(
    `Generating tiles for ${targets.length} templates (concurrency ${CONCURRENCY})…\n`,
  );

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    // Heavy templates (canvas/WebGL animation) can blow past the default
    // 180s CDP timeout on captureScreenshot — give them room (e.g. the-bay).
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
