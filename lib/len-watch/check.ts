// LEN WATCH'S CONFIRMATION (spec local 2026-10-30-len-watch, §5.2): before anyone is bothered, OpenLen
// opens the published page in its own Chromium — the eyes' launcher, with the SSRF guard — and looks
// with the snippet's own predicate. A visitor's broken extension doesn't reach here as an outage.
//
// 🔴 The PUBLIC address, never 127.0.0.1 or serveRelease: a loopback origin is routed to the draft
// database (lib/backend/environment-routing.ts), and a crash can depend on production data. Every
// visit carries `_lw=<ms>` so no cache hands back the old, broken page after a fix.
import "server-only";

import type { Browser } from "puppeteer";

import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";
import { allowEgressOrigin } from "@/lib/security/egress-proxy";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";

import { scrubText } from "./report";
import { BLANK_CHECK_JS, WATCH_SETTLE_MS } from "./snippet";

export interface LoadCheck {
  loads: boolean;
  reason: "ok" | "blank" | "unreachable";
  /** The page's own uncaught errors, scrubbed, at most five. */
  errors: string[];
}

const MAX_ERRORS = 5;

export function withCacheBuster(url: string, now: number): string {
  const u = new URL(url);
  u.searchParams.append("_lw", String(now));
  return u.toString();
}

export async function checkPublishedLoads(
  url: string,
  internals: { lanzar?: () => Promise<Browser>; allowOrigins?: readonly string[]; settleMs?: number; now?: () => number } = {},
): Promise<LoadCheck> {
  const allowOrigins = [...(internals.allowOrigins ?? [])];
  const releases = allowOrigins.map((o) => allowEgressOrigin(o));
  const browser = await (internals.lanzar ?? lanzarChromium)();
  try {
    const page = await browser.newPage();
    await installSubresourceSsrfGuard(page, { allowOrigins });
    const errors: string[] = [];
    page.on("pageerror", (e) => {
      if (errors.length < MAX_ERRORS) errors.push(scrubText(e instanceof Error ? e.message : String(e)).slice(0, 300));
    });
    let status = 0;
    try {
      const res = await page.goto(withCacheBuster(url, (internals.now ?? Date.now)()), { waitUntil: "load", timeout: 20_000 });
      status = res?.status() ?? 0;
    } catch {
      return { loads: false, reason: "unreachable", errors };
    }
    if (status >= 500 || status === 0) return { loads: false, reason: "unreachable", errors };
    await new Promise((r) => setTimeout(r, internals.settleMs ?? WATCH_SETTLE_MS));
    const blank = (await page.evaluate(`(${BLANK_CHECK_JS})()`).catch(() => true)) as boolean;
    return blank ? { loads: false, reason: "blank", errors } : { loads: true, reason: "ok", errors };
  } finally {
    for (const release of releases) release();
    await browser.close().catch(() => undefined);
  }
}
