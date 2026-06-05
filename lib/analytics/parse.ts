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

// Crawlers, link-preview fetchers, monitors, headless browsers and HTTP
// libraries — none are real visitors. Matched case-insensitively. Same spirit
// as Vercel/Plausible bot exclusion: keeps headline numbers honest instead of
// inflated by automated traffic. Deliberately uses `bot/` (versioned crawlers)
// + explicit names rather than a bare `bot` so it doesn't drop real phones
// whose UA contains the substring (e.g. the "Cubot" brand) or in-app browsers.
const BOT_RE =
  /bot\/|spider|crawler|slurp|mediapartners|facebookexternalhit|whatsapp\/|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|redditbot|pinterest\/|embedly|skypeuripreview|vkshare|tumblr\/|bitlybot|nuzzel|w3c_validator|semrush|ahrefs|mj12bot|dotbot|dataforseo|screaming frog|headless|phantomjs|puppeteer|playwright|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|statuscake|site24x7|datadog|newrelic|curl\/|wget\/|python-requests|python-urllib|aiohttp|httpx|axios\/|go-http-client|java\/|okhttp|node-fetch|scrapy|httpclient|libwww|mechanize|guzzle|postman|insomnia/i;

/** True for crawlers / bots / automated traffic that shouldn't count as a real
 *  visit. An empty UA (no real browser sends one on a beacon) counts as a bot. */
export function isBot(ua: string): boolean {
  if (!ua) return true;
  return BOT_RE.test(ua);
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
