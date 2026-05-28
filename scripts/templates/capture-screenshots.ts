// Generate full-page screenshot references for every template (Quality S2).
//
// These full-page JPGs are fed into the AI generation calls as a multimodal
// REFERENCE image so Gemini matches the curated quality bar (density,
// spacing, shadow/radius discipline). They are NEVER served to a published
// page — see lib/templates/capture-screenshot.ts + schema.ts screenshotUrl.
//
// Strategy per template (mirrors generate-thumbnails.ts):
//   1. Look up the latest contentHash from DB
//   2. Skip if screenshotUrl already encodes that contentHash (idempotent;
//      --force re-captures all)
//   3. Render the storageUrl full-page at 1280-wide viewport, JPG q82
//   4. Upload to `screenshots/<id>-<contentHash>.jpg`
//   5. Persist screenshotUrl
//
// Concurrency 3 — same memory reasoning as the thumbnail script, and
// full-page captures are if anything heavier.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  captureTemplateScreenshot,
  launchScreenshotBrowser,
} from "@/lib/templates/capture-screenshot";

const CONCURRENCY = 3;

interface Row {
  id: string;
  storageUrl: string;
  contentHash: string;
  screenshotUrl: string | null;
}

async function listTargets(force: boolean): Promise<Row[]> {
  const rows = await db
    .select({
      id: schema.templates.id,
      storageUrl: schema.templates.storageUrl,
      contentHash: schema.templates.contentHash,
      screenshotUrl: schema.templates.screenshotUrl,
    })
    .from(schema.templates)
    .where(eq(schema.templates.status, "published"));

  if (force) return rows;

  // Skip rows whose existing screenshotUrl already encodes the current
  // contentHash — they're up to date. Match by the filename token so we
  // aren't coupled to the URL prefix.
  return rows.filter(
    (r) => !r.screenshotUrl || !r.screenshotUrl.includes(`${r.id}-${r.contentHash}`),
  );
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const targets = await listTargets(force);
  if (targets.length === 0) {
    // eslint-disable-next-line no-console
    console.log("All templates already have up-to-date screenshots. Nothing to do.");
    return;
  }
  // eslint-disable-next-line no-console
  console.log(
    `Capturing full-page screenshots for ${targets.length} templates (concurrency ${CONCURRENCY})…\n`,
  );

  const browser = await launchScreenshotBrowser();
  const t0 = Date.now();
  let ok = 0;
  const failed: { id: string; reason: string }[] = [];
  try {
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const chunk = targets.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (row) => {
          const start = Date.now();
          try {
            await captureTemplateScreenshot(browser, row);
            // eslint-disable-next-line no-console
            console.log(`  ✓ ${row.id.padEnd(22)} ${Date.now() - start}ms`);
            ok++;
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            // eslint-disable-next-line no-console
            console.log(`  ✗ ${row.id.padEnd(22)} ${Date.now() - start}ms — ${reason}`);
            failed.push({ id: row.id, reason });
          }
        }),
      );
    }
  } finally {
    await browser.close();
  }

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
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
