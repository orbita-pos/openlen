// Minimal User-Agent + header parsing for the analytics collector.
//
// We deliberately avoid pulling in ua-parser-js (~70KB) — every beacon
// would pay that cost in route bundling. The matchers below are heuristic
// but correct for ~99% of real traffic; an unrecognised UA falls into
// device:"desktop", browser:"other" which is the least-wrong default.

export type Device = "mobile" | "desktop" | "tablet";
export type Browser = "chrome" | "safari" | "firefox" | "edge" | "other";

export interface ParsedUA {
  device: Device;
  browser: Browser;
}

export function parseUserAgent(ua: string): ParsedUA {
  if (!ua) return { device: "desktop", browser: "other" };

  // Tablet detection FIRST — iPad and Android-tablet UAs often look like
  // mobile UAs at a glance. Android tablets are Android UAs WITHOUT the
  // "Mobile" token (which only ships on phones).
  const isTablet =
    /iPad/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua));
  const isMobile =
    !isTablet && /Mobi|Android|iPhone|iPod|Opera Mini|IEMobile/.test(ua);
  const device: Device = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  // Browser order matters — Edge UAs contain "Chrome" and "Safari", and
  // Chrome UAs contain "Safari". Check the most-specific token first.
  let browser: Browser = "other";
  if (/Edg\//.test(ua)) browser = "edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "other";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "chrome";
  else if (/Firefox\//.test(ua)) browser = "firefox";
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "safari";

  return { device, browser };
}

/** ISO-3166 alpha-2 from Cloudflare's `CF-IPCountry` header. Returns null
 *  when CF isn't in front (dev / direct origin hit) or the header is
 *  something non-standard ("XX" for unknown, "T1" for Tor). */
export function normalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.length !== 2) return null;
  if (!/^[A-Z]{2}$/.test(trimmed)) return null;
  // CF emits 'XX' for unknown and 'T1' for Tor — both are real values but
  // they'd skew the country breakdown. Drop them to null.
  if (trimmed === "XX" || trimmed === "T1") return null;
  return trimmed;
}
