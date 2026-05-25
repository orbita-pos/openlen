// Generate WebP thumbnail previews for every template via headless Chrome.
//
// Why: the marketing pages currently render each TemplateCard as a live
// <iframe> of the template HTML. That ships ~300KB of Tailwind CDN per
// card plus the HTML body — 9 cards on the homepage = ~3MB just for
// previews. Swapping to a pre-rendered WebP image cuts each card to
// ~50-80KB and avoids the JS execution entirely.
//
// Strategy per template:
//   1. Look up the latest contentHash from DB
//   2. Skip if thumbnailUrl already encodes that contentHash (idempotent)
//   3. Launch a Puppeteer page at the storageUrl (R2-hosted HTML)
//   4. Wait for networkidle + document.fonts.ready
//   5. Screenshot 1280×800 PNG → sharp → WebP quality 85
//   6. Upload to storage at `thumbnails/<id>-<contentHash>.webp`
//   7. Persist thumbnailUrl in DB
//
// Concurrency: 3 templates in parallel. Above that each headless tab
// starts fighting for memory on small VPS hosts; below misses easy wins.
//
// Total runtime for 165 templates: ~6-8 min.

import { eq } from "drizzle-orm";
import puppeteer, { type Browser } from "puppeteer";
import sharp from "sharp";
import { db, schema } from "@/lib/db";
import { setTemplateThumbnail } from "@/lib/templates/store";
import { getTemplateStorage } from "@/lib/storage/templates";

const VIEWPORT = { width: 1280, height: 800 };
const CONCURRENCY = 3;
const PAGE_TIMEOUT_MS = 30_000;
const POST_LOAD_SETTLE_MS = 250;

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
      status: schema.templates.status,
    })
    .from(schema.templates)
    .where(eq(schema.templates.status, "published"));

  if (force) return rows;

  // Skip rows whose existing thumbnailUrl already encodes the current
  // contentHash — they're up to date. Match by filename token to avoid
  // tight coupling to the URL prefix.
  return rows.filter((r) => {
    if (!r.thumbnailUrl) return true;
    // Match contentHash AND the new .avif extension. Templates still on
    // .webp will re-generate as AVIF on next run.
    return (
      !r.thumbnailUrl.includes(`${r.id}-${r.contentHash}`) ||
      !r.thumbnailUrl.endsWith(".avif")
    );
  });
}

async function captureOne(
  browser: Browser,
  row: Row,
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  const page = await browser.newPage();
  try {
    await page.setViewport(VIEWPORT);
    await page.goto(row.storageUrl, {
      waitUntil: "networkidle0",
      timeout: PAGE_TIMEOUT_MS,
    });
    // Wait for web fonts to actually render — otherwise the screenshot
    // captures the FOUT fallback and the thumbnail looks wrong.
    await page.evaluate(() =>
      "fonts" in document ? document.fonts.ready : Promise.resolve(),
    );
    await new Promise((resolve) => setTimeout(resolve, POST_LOAD_SETTLE_MS));

    const pngBuffer = (await page.screenshot({
      type: "png",
      fullPage: false,
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    })) as Buffer;

    // AVIF over WebP — typically ~30% smaller at visually-equivalent
    // quality (q65 AVIF ≈ q85 WebP). Safari 16+ / Chrome / Firefox all
    // support AVIF; the alpha audience for OpenLen is essentially 100%.
    const avifBuffer = await sharp(pngBuffer)
      .avif({ quality: 65, effort: 4 })
      .toBuffer();

    const key = `thumbnails/${row.id}-${row.contentHash}.avif`;
    const storage = getTemplateStorage();
    const uploaded = await storage.upload({
      key,
      contentType: "image/avif",
      body: avifBuffer,
    });

    await setTemplateThumbnail(row.id, uploaded.url);
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
    const results = await Promise.all(
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
    void results;
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
  // (matches the convention used on the Hetzner box, where
  // /usr/bin/chromium-browser is preinstalled and Puppeteer's bundled Chrome
  // is intentionally skipped). Falls back to whatever Puppeteer was shipped
  // with when no path is provided.
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
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
