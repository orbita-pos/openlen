// Helpers to turn an image into a Gemini `inlineData` part (Quality S2).
//
// The native Gemini streamGenerateContent API (used by @openlen/ai-gateway)
// does NOT fetch remote URLs the way the OpenAI-compatible endpoint does — it
// only accepts base64 `inlineData`. So the reference image is fetched (or
// rendered) here and handed to the gateway as base64.
//
// Both helpers are BEST-EFFORT: any failure (fetch error, oversize, render
// crash) returns null and the caller proceeds text-only. The image is a
// quality boost, never load-bearing.

import type { InlineImage } from "@/lib/ai-gateway";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// 4 MB raw cap — full-page template JPGs at q82 run ~100–600 KB; this leaves
// generous headroom while staying well under Gemini's request size limit.
const FETCH_MAX_BYTES = 4 * 1024 * 1024;

function pickImageMime(contentType: string, url: string): string | null {
  const ct = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (ALLOWED_MIME.includes(ct)) return ct;
  const u = url.toLowerCase();
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".gif")) return "image/gif";
  return null;
}

/** Fetch an image URL and return it as a base64 inlineData part. Null on any
 *  failure (non-200, non-image, empty, or over the size cap). */
export async function fetchImageAsInlineData(
  url: string,
  opts: { maxBytes?: number; signal?: AbortSignal; redirect?: RequestRedirect } = {},
): Promise<InlineImage | null> {
  const maxBytes = opts.maxBytes ?? FETCH_MAX_BYTES;
  try {
    // redirect:"error" is for USER-SUPPLIED urls (agent attached images): the
    // caller validates the host first, and following a redirect would let a
    // public host bounce the fetch to an internal one past that check.
    const res = await fetch(url, {
      signal: opts.signal,
      cache: "no-store",
      redirect: opts.redirect ?? "follow",
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[inline-image] fetch ${url} → ${res.status}`);
      return null;
    }
    const mimeType = pickImageMime(res.headers.get("content-type") ?? "", url);
    if (!mimeType) {
      // eslint-disable-next-line no-console
      console.warn(`[inline-image] ${url} is not a supported image type`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > maxBytes) {
      // eslint-disable-next-line no-console
      console.warn(
        `[inline-image] ${url} size ${buf.length}B outside (0, ${maxBytes}] — skipping`,
      );
      return null;
    }
    return { mimeType, dataBase64: buf.toString("base64") };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[inline-image] fetch failed for ${url}:`, err);
    return null;
  }
}

/** Render an HTML document to a full-page JPEG and return it as an inlineData
 *  part — used by the Chat tab to show the model the CURRENT page as visual
 *  context. Best-effort: returns null on render failure or if it exceeds the
 *  size cap. Puppeteer is dynamic-imported so it stays out of the route's
 *  static bundle.
 *
 *  NOTE: this spawns headless Chromium per call, so the ai-design caller
 *  leaves it OFF by default — opt in with OPENLEN_AIDESIGN_PAGE_REFERENCE=1.
 *  (The /api/generate reference path doesn't use this — it fetches a
 *  pre-rendered template screenshot.) */
export async function renderHtmlToInlineImage(
  html: string,
  opts: { maxBytes?: number } = {},
): Promise<InlineImage | null> {
  // Spec: inline base64 when small. 1 MB JPEG of a full page is plenty of
  // visual fidelity for a reference and keeps the request lean.
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  try {
    const puppeteer = (await import("puppeteer")).default;
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
    // Override HOME for the Chrome subprocess so its XDG bootstrap (mimeapps,
    // crashpad database, default config) lands somewhere writable. The
    // openlen-app systemd unit hardens /home/<service-user> as read-only via
    // ProtectHome — without this, Chrome crashes at launch with
    // "cannot create directory '~/.local': Read-only file system".
    // /tmp is always writable; the env override only affects the spawned
    // Chrome process, not the Node parent.
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
      env: {
        ...process.env,
        HOME: "/tmp",
      },
    });
    try {
      const page = await browser.newPage();
      // Block subresource fetches to internal/loopback/metadata hosts — this
      // HTML is model-generated and not fully trusted. (SSRF guard.)
      await installSubresourceSsrfGuard(page);
      await page.setViewport({ width: 1280, height: 720 });
      await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
      // Tailwind CDN + Google Fonts apply async after `load`; wait for fonts
      // and give the CDN a beat so the capture isn't the unstyled FOUT state.
      await page.evaluate(() =>
        "fonts" in document ? document.fonts.ready : Promise.resolve(),
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      const shot = (await page.screenshot({
        type: "jpeg",
        quality: 75,
        fullPage: true,
      })) as Buffer;
      if (shot.length === 0 || shot.length > maxBytes) {
        // eslint-disable-next-line no-console
        console.warn(
          `[inline-image] rendered page ${shot.length}B exceeds cap ${maxBytes} — skipping reference`,
        );
        return null;
      }
      return { mimeType: "image/jpeg", dataBase64: Buffer.from(shot).toString("base64") };
    } finally {
      await browser.close();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[inline-image] renderHtmlToInlineImage failed:", err);
    return null;
  }
}
