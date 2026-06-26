// Branded social card (og:image fallback) — a 1200×630 raster shown when a
// page has no real hero image to unfurl with. The card is the cream-ground +
// coral-initial-disc + title design (same language as the legacy SVG card in
// ensure-page-meta), but rendered to a PNG so WhatsApp / Facebook / iMessage / X
// actually display it (they ignore SVG og:images).
//
// Why a render: the image pipeline (Rust @openlen/images crate) decodes only
// JPEG/PNG/GIF/WebP — no SVG — and there's no `sharp`. So any server-side raster
// goes through headless Chrome. This render is cheap + safe (our own static
// HTML, no CDN/network, can't hang) — the opposite risk profile of a full
// user-page render. Mirrors the launch config in lib/projects/thumbnail.ts.

import { captureException } from "@inariwatch/capture";

const WIDTH = 1200;
const HEIGHT = 630;
const HARD_DEADLINE_MS = 12_000;

const DEFAULT_ACCENT_FROM = "#FF7152";
const DEFAULT_ACCENT_TO = "#F03E1A";

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function initialOf(name: string): string {
  const t = (name ?? "").trim();
  if (!t) return "?";
  const first = t.charAt(0).toUpperCase();
  return /[A-Z0-9]/.test(first) ? first : t.charAt(0) || "?";
}

/** Validate a CSS hex color; fall back to the brand coral if it's anything
 *  else (the accent flows into inline CSS — never trust it blindly). */
function safeHex(c: string | null | undefined): string | null {
  return typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c.trim())
    ? c.trim()
    : null;
}

export interface OgCardInput {
  title: string;
  /** Disc gradient end color (the brand accent). Defaults to brand coral. */
  accent?: string | null;
}

/** PURE — the self-contained HTML the headless render screenshots. Inline CSS,
 *  system font (no network), fixed 1200×630 frame. Safe to unit-test. */
export function buildOgCardHtml(input: OgCardInput): string {
  const title = (input.title ?? "").trim() || "Untitled page";
  const accentTo = safeHex(input.accent) ?? DEFAULT_ACCENT_TO;
  const letter = escHtml(initialOf(title));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${WIDTH}px;height:${HEIGHT}px}
  .card{width:${WIDTH}px;height:${HEIGHT}px;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:44px;padding:80px;
    background:#FFFDF9;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
  .disc{width:148px;height:148px;border-radius:34px;display:flex;align-items:center;
    justify-content:center;color:#fff;font-size:74px;font-weight:700;line-height:1;
    background:linear-gradient(180deg,${DEFAULT_ACCENT_FROM},${accentTo});
    box-shadow:0 16px 48px rgba(240,62,26,.22)}
  .title{max-width:1000px;text-align:center;color:#0B0B0C;font-size:60px;
    line-height:1.08;font-weight:800;letter-spacing:-.02em;
    display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
</style></head><body>
  <div class="card">
    <div class="disc">${letter}</div>
    <div class="title">${escHtml(title)}</div>
  </div>
</body></html>`;
}

/** Render the branded card to a 1200×630 PNG. Bounded + soft-fail (returns
 *  null on any error) so a publish is never blocked. No SSRF guard / no
 *  network-idle wait: the HTML is ours and loads no external assets. */
export async function renderOgCard(input: OgCardInput): Promise<Buffer | null> {
  const html = buildOgCardHtml(input);
  try {
    const { default: puppeteer } = await import("puppeteer");
    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
    // ProtectHome=read-only on the box → Chrome needs a writable HOME; /tmp is
    // PrivateTmp-isolated. Linux only (memory: puppeteer-hetzner-chrome).
    const launchEnv =
      process.platform === "linux"
        ? { ...process.env, HOME: "/tmp" }
        : process.env;
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      env: launchEnv,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-crash-reporter",
      ],
    });
    const watchdog = setTimeout(() => {
      void browser.close().catch(() => {});
    }, HARD_DEADLINE_MS);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: WIDTH, height: HEIGHT });
      await page.setContent(html, { waitUntil: "load", timeout: HARD_DEADLINE_MS });
      await page
        .evaluate(() => ("fonts" in document ? document.fonts.ready : Promise.resolve()))
        .catch(() => {});
      const png = (await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      })) as Buffer;
      return png;
    } finally {
      clearTimeout(watchdog);
      await browser.close().catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A launch/executable-class failure means the pipeline is broken for EVERY
    // publish (e.g. a moved Chromium binary) — surface that; a transient render
    // hiccup just soft-fails to the logo og:image.
    if (/Failed to launch|spawn|ENOENT|executablePath|out of memory/i.test(msg)) {
      captureException(err instanceof Error ? err : new Error(msg), {
        tags: { area: "og-card-render" },
      });
    } else {
      // eslint-disable-next-line no-console
      console.warn("[og-card] render failed; falling back", msg);
    }
    return null;
  }
}
