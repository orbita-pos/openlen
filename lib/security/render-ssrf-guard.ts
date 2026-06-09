// SSRF guard for headless-Chrome renders of UNTRUSTED HTML.
//
// When we page.setContent(userHtml) on the box, Chrome fetches every absolute
// subresource the HTML references (<img>, <script>, <link>, CSS url(), fetch,
// <iframe>, …) with the server's full network stack. Without a guard a tenant
// could point those at the box's own loopback Next app (127.0.0.1:3000), the
// private LAN, or the cloud-metadata endpoint (169.254.169.254 on Hetzner) —
// a classic blind-SSRF / internal-probe surface.
//
// The scrape path (lib/style-match/scrape) already validates its NAVIGATION
// target with the same private-range logic, but setContent has no navigation
// URL — the danger is the subresources. So we intercept requests and abort any
// whose host is loopback / link-local / RFC-1918 / otherwise internal. Public
// asset hosts (Tailwind CDN, Google Fonts, R2) resolve to public IPs and pass.
//
// Used by lib/projects/thumbnail.ts (card thumbnails of user pages) and
// lib/ai/inline-image.ts (vision-critic reference shots of generated HTML).

import dns from "node:dns/promises";
import type { Page } from "puppeteer";
import { ipInPrivateRange } from "@/lib/style-match/scrape/validate-url";

// Schemes that never hit the network in a way that can reach internal hosts.
const ALLOWED_NON_HTTP_SCHEMES = new Set(["data:", "blob:", "about:"]);

const LITERAL_IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** True when a subresource host must be blocked. Fail-closed: anything we
 *  can't resolve, or that looks internal, is blocked. */
async function hostIsBlocked(hostname: string): Promise<boolean> {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  // Bare hostnames (no dot) — "localhost", "metadata", internal service names —
  // and the explicit internal suffixes are never legitimate public assets.
  if (
    !h ||
    h === "localhost" ||
    h === "0.0.0.0" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    !h.includes(".")
  ) {
    return true;
  }
  if (LITERAL_IPV4.test(h)) return ipInPrivateRange(h);
  // IPv6 literals contain ":" (and no dot already returned above) — block them
  // conservatively rather than parse every private v6 range.
  if (h.includes(":")) return true;
  try {
    const { address } = await dns.lookup(h, { family: 4 });
    return ipInPrivateRange(address);
  } catch {
    return true;
  }
}

/** Install request interception on `page` that blocks subresource fetches to
 *  internal/loopback/link-local hosts. Call BEFORE setContent. Safe for public
 *  CDN/font/asset fetches — they resolve to public IPs and continue.
 *
 *  `allowOrigins` punches exact `host[:port]` holes through the block — used
 *  by flight-check, whose audit target is its own ephemeral 127.0.0.1 server
 *  (navigation + /assets fetches must pass while everything else internal
 *  stays blocked). */
export async function installSubresourceSsrfGuard(
  page: Page,
  opts?: { allowOrigins?: string[] },
): Promise<void> {
  const allowedOrigins = new Set(
    (opts?.allowOrigins ?? []).map((o) => o.toLowerCase()),
  );
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    // The handler MUST resolve every request exactly once (continue/abort) or
    // the page hangs until the navigation timeout. Wrapped so a throw still
    // aborts rather than dangling.
    void (async () => {
      try {
        const url = req.url();
        const scheme = url.slice(0, url.indexOf(":") + 1).toLowerCase();
        if (ALLOWED_NON_HTTP_SCHEMES.has(scheme)) {
          await req.continue();
          return;
        }
        if (scheme !== "http:" && scheme !== "https:") {
          await req.abort("blockedbyclient");
          return;
        }
        const { hostname, host } = new URL(url);
        if (allowedOrigins.has(host.toLowerCase())) {
          await req.continue();
          return;
        }
        if (await hostIsBlocked(hostname)) {
          await req.abort("blockedbyclient");
          return;
        }
        await req.continue();
      } catch {
        // Already-handled / navigation race / parse failure — fail closed.
        try {
          await req.abort("blockedbyclient");
        } catch {
          /* request already resolved elsewhere */
        }
      }
    })();
  });
}
