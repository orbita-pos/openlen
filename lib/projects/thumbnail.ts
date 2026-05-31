// Project card thumbnails — headless-Chrome render of a project's HTML into
// a small AVIF preview, stored via the uploads adapter and recorded in
// `projects.thumbnailUrl`. The /projects grid + list cards read that column
// (falling back to a placeholder icon when it's null).
//
// Mirrors the curated-template thumbnail pipeline (scripts/templates/
// generate-thumbnails.ts) but with two differences that matter:
//   1. A project's HTML lives in the DB (`data.html`), not at a public URL,
//      so we render via page.setContent() — deterministic, no CDN/DNS
//      staleness, and works without the page being published.
//   2. This runs inside the Next.js server (publish + create paths), not a
//      standalone script. Puppeteer is dynamically imported so it never
//      enters the bundle of routes that merely touch lib/projects.ts, and is
//      externalised in next.config.ts so webpack hands the require to Node.
//
// Triggers (all fire-and-forget, all soft-fail — a thumbnail is never worth
// failing a publish/create over): project create (generate + paste) and
// publish (refresh to the latest bytes). Template clones inherit the
// template's own thumbnail at create time instead (see from-template route).
// Existing projects are backfilled by `npm run projects:thumbnails`.

import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { captureException } from "@inariwatch/capture";
import { db, schema } from "@/lib/db";
import { processImage } from "@/lib/images";
import { getStorage } from "@/lib/storage";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";

// 16:10 — matches the card's `aspect-[16/10]` frame and the template
// thumbnail viewport, so previews are framed identically across the app.
const VIEWPORT = { width: 1280, height: 800 };
// setContent fetches absolute assets (Tailwind CDN, Google Fonts, R2 images,
// injected logo) over the network; networkidle0 waits for them. A page that
// hangs on a dead CDN (or a sandbox with egress blocked) trips this and the
// render soft-fails to null — acceptable, the card just keeps its placeholder.
const PAGE_TIMEOUT_MS = 20_000;
const POST_LOAD_SETTLE_MS = 300;
// Hard wall-clock ceiling for a single render. setContent + waitForNetworkIdle
// are bounded by PAGE_TIMEOUT_MS, but screenshot/rasterisation is NOT — a tab
// that hangs there would otherwise hold its semaphore slot forever and
// eventually deadlock the whole feature. A watchdog force-closes the browser
// past this, which unblocks the awaited screenshot and frees the slot.
const HARD_DEADLINE_MS = 35_000;
// Skip pathological pages. Most ingress paths cap HTML at 8 MB, but the AI
// generate path is uncapped at this point — don't feed a multi-MB document to
// Chrome on the small box.
const MAX_HTML_BYTES = 6 * 1024 * 1024;

// Box protection: each headless tab is ~150-300 MB. On the single CX22 we
// default to ONE render at a time (renders are fire-and-forget + queue, so the
// extra latency is invisible). Tunable via env without a redeploy.
const MAX_CONCURRENT = Math.max(
  1,
  Number(process.env.OPENLEN_THUMBNAIL_CONCURRENCY) || 1,
);
let active = 0;
const waiters: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  // `while`, not `if`: a woken waiter re-checks in case another caller took
  // the freed slot first (closes the classic wake-up race).
  while (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

/** Render `html` to an AVIF card thumbnail, upload it, and persist
 *  `projects.thumbnailUrl`. Returns the public URL, or null on any failure
 *  (never throws — callers fire-and-forget). Does NOT bump `updatedAt`: a
 *  thumbnail refresh isn't an edit and must not reorder the list. */
export async function renderProjectThumbnail(opts: {
  projectId: string;
  html: string;
}): Promise<string | null> {
  const { projectId, html } = opts;
  if (!html || html.trim().length === 0) return null;
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    // eslint-disable-next-line no-console
    console.warn(`[thumbnail] skipping project ${projectId}: HTML over ${MAX_HTML_BYTES}B`);
    return null;
  }
  try {
    return await withSlot(() => doRender(projectId, html));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[thumbnail] render failed for project ${projectId}`, err);
    // A dead CDN / network-idle timeout is an expected soft-fail (warn only).
    // A launch/executable/OOM-class failure means the pipeline is broken for
    // EVERY project (e.g. a Chromium apt upgrade moved the binary) — report
    // that to InariWatch so a total-yet-silent regression is visible.
    const msg = err instanceof Error ? err.message : String(err);
    if (/Failed to launch|spawn|ENOENT|executablePath|Target closed|out of memory|cannot create directory/i.test(msg)) {
      captureException(err instanceof Error ? err : new Error(msg), {
        tags: { area: "project-thumbnail", projectId },
      });
    }
    return null;
  }
}

async function doRender(projectId: string, html: string): Promise<string | null> {
  // Dynamic import keeps puppeteer out of the static module graph of every
  // route that imports lib/projects.ts. Paired with serverExternalPackages.
  const { default: puppeteer } = await import("puppeteer");
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;

  // On the Hetzner box the service runs with ProtectHome=read-only, so Chrome
  // can't write to $HOME. PrivateTmp=true gives an isolated, writable /tmp —
  // point HOME there. (memory: puppeteer-hetzner-chrome.) Only on Linux: on a
  // Windows/macOS dev box HOME=/tmp would be wrong, so leave the env alone.
  const launchEnv =
    process.platform === "linux" ? { ...process.env, HOME: "/tmp" } : process.env;

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    env: launchEnv,
    // No --user-data-dir: puppeteer mints a unique temp profile per launch
    // (and removes it on close), so concurrent renders never collide.
    // --disable-crash-reporter keeps crashpad from writing dumps under the
    // shared HOME=/tmp.
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-crash-reporter",
    ],
  });
  // Watchdog: if anything past the bounded load phase hangs (screenshot /
  // rasterisation has no timeout of its own), force-close the browser so the
  // awaited call rejects, the finally runs, and the semaphore slot is freed.
  const watchdog = setTimeout(() => {
    void browser.close().catch(() => {});
  }, HARD_DEADLINE_MS);
  const page = await browser.newPage();
  try {
    // Block subresource fetches to internal/loopback/metadata hosts before any
    // of this user-controlled HTML's assets load. (SSRF guard.)
    await installSubresourceSsrfGuard(page);
    await page.setViewport(VIEWPORT);
    // setContent's waitUntil only takes load/domcontentloaded — neither waits
    // for the Tailwind Play CDN to fetch + generate styles (it scans classes
    // AFTER load). So wait for load, then for the network to go idle, which is
    // the equivalent of goto's networkidle0 (best-effort — a dead CDN tab just
    // settles on the timeout and we capture whatever rendered).
    await page.setContent(html, { waitUntil: "load", timeout: PAGE_TIMEOUT_MS });
    await page
      .waitForNetworkIdle({ idleTime: 500, timeout: PAGE_TIMEOUT_MS })
      .catch(() => {});
    // Wait for web fonts so the capture isn't the FOUT fallback.
    await page.evaluate(() =>
      "fonts" in document ? document.fonts.ready : Promise.resolve(),
    );
    await new Promise((resolve) => setTimeout(resolve, POST_LOAD_SETTLE_MS));

    const png = (await page.screenshot({
      type: "png",
      fullPage: false,
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    })) as Buffer;

    // AVIF q65 ≈ WebP q85 at ~30% smaller — same call the template thumbnail
    // pipeline uses. width:0 keeps the intrinsic 1280×800.
    const { variants } = await processImage({
      input: png,
      variants: [{ width: 0, format: "avif", quality: 65 }],
      autoOrient: false,
      withoutEnlargement: true,
    });
    const avif = variants[0].bytes;

    // Content-addressed filename so a re-render produces a NEW URL — the card
    // reads thumbnailUrl directly, so a fresh URL sidesteps CDN/browser cache
    // with zero purge. (Superseded objects are tiny ~50 KB AVIFs; left to a
    // future sweep rather than deleted inline.)
    const hash = createHash("sha1").update(avif).digest("hex").slice(0, 12);
    const key = `project-thumbnails/${projectId}-${hash}.avif`;
    const { url } = await getStorage().upload({
      key,
      contentType: "image/avif",
      body: avif,
    });

    await db
      .update(schema.projects)
      .set({ thumbnailUrl: url })
      .where(eq(schema.projects.id, projectId));
    return url;
  } finally {
    clearTimeout(watchdog);
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
