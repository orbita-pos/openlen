// Favicon / logo extraction from publish-ready HTML. DOM walk lives in
// crates/html-engine/src/publish/logo.rs (extract_logo); the pure helpers
// below (isDataUri / decodeDataUri) stay in TS because they're plain regex
// + base64 work with no DOM dependency.

import {
  extractLogo as rustExtractLogo,
  type ExtractedLogo,
} from "@/lib/html-engine";

export type { ExtractedLogo };

export function extractLogoFromHtml(html: string): ExtractedLogo | null {
  return rustExtractLogo(html);
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
