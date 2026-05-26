// Extract a candidate favicon / logo URL from a publish-ready HTML document.
//
// Tries, in order:
//   1. <link rel="icon" href="…">              (any rel that contains "icon")
//   2. <meta property="og:image" content="…"> (page social-share image)
//
// Returns null when nothing matches. The caller is responsible for
// deciding whether to persist a data: URI as-is (small enough) or upload
// it to object storage first (see upload-data-uri.ts).

import * as cheerio from "cheerio";

export interface ExtractedLogo {
  /** Raw href as it appears in the HTML (data: / absolute / relative). */
  href: string;
  /** True when the href is a data: URI; the caller probably wants to
   *  decode and re-host it before persisting. */
  isDataUri: boolean;
}

export function extractLogoFromHtml(html: string): ExtractedLogo | null {
  if (!html) return null;
  let $: ReturnType<typeof cheerio.load>;
  try {
    $ = cheerio.load(html);
  } catch {
    return null;
  }

  // Prefer the highest-resolution declared icon. Walk all <link rel> values
  // that *contain* "icon" so we catch "icon", "shortcut icon", "apple-touch-
  // icon", etc.
  const iconLinks = $("link[rel]").filter((_, el) => {
    const rel = ($(el).attr("rel") || "").toLowerCase();
    return rel.split(/\s+/).some((r) => r.includes("icon"));
  });
  for (const el of iconLinks.toArray()) {
    const href = $(el).attr("href")?.trim();
    if (href) return { href, isDataUri: isDataUri(href) };
  }

  const og = $('meta[property="og:image"]').attr("content")?.trim();
  if (og) return { href: og, isDataUri: isDataUri(og) };

  return null;
}

export function isDataUri(href: string): boolean {
  return /^data:/i.test(href);
}

interface DecodedDataUri {
  contentType: string;
  body: Buffer;
}

/** Decode a `data:image/...;base64,...` or `data:...;utf8,...` URL into
 *  a Buffer. Returns null on malformed input. */
export function decodeDataUri(uri: string): DecodedDataUri | null {
  const m = uri.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!m) return null;
  const contentType = m[1] || "application/octet-stream";
  const isBase64 = !!m[2];
  const payload = m[3];
  try {
    const body = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return { contentType, body };
  } catch {
    return null;
  }
}
