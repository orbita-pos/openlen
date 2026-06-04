import { auth } from "@/auth";
import { consumeToken, RATE_LIMITS } from "@/lib/rate-limit";
import {
  extractFromImage,
  extractFromText,
  type ExtractedBusinessData,
} from "@/lib/style-match/autofill";
import { orchestrate } from "@/lib/style-match/scrape/orchestrate";
import type { ScrapeError } from "@/lib/style-match/types";

// POST /api/profiles/extract
//
// Returns a DRAFT ExtractedBusinessData for the profile confirm screen, reusing
// the existing extractors — WITHOUT filling a project or debiting credits.
//   { source: "image", image: base64, imageMime?: "image/jpeg"|"image/png" }
//   { source: "text",  description: string }
//   { source: "url",   url: string }
//
// The "url" path screenshots the page and reads it with vision (the hero path
// for the LatAm persona is a screenshot of their Instagram, which dodges IG's
// anti-scraping). Tier-1 raw-HTML hits fall back to text extraction.

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return json(401, { error: "unauthenticated" });
  const userId = session.user.id;

  const rate = consumeToken(`profile-extract:${userId}`, RATE_LIMITS.autofill);
  if (!rate.allowed) {
    const retryAfterSec = Math.ceil(rate.retryAfterMs / 1000);
    return new Response(
      JSON.stringify({
        error: `Rate limit excedido — máximo ${rate.limit} por hora.`,
        retryAfterSec,
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(retryAfterSec),
        },
      },
    );
  }

  let body: {
    source?: unknown;
    image?: unknown;
    imageMime?: unknown;
    description?: unknown;
    url?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON body" });
  }

  const source =
    body.source === "image" || body.source === "text" || body.source === "url"
      ? body.source
      : null;
  if (!source) {
    return json(400, { error: "source must be 'image', 'text', or 'url'" });
  }

  try {
    let data: ExtractedBusinessData;

    if (source === "image") {
      const buf = decodeImage(body.image);
      if (!buf) return json(400, { error: "image (base64) is required" });
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        return json(400, { error: "image too large (max 8 MB)" });
      }
      const mime = body.imageMime === "image/png" ? "image/png" : "image/jpeg";
      const r = await extractFromImage({ image: buf, mime });
      if (!r.ok) return json(422, { error: r.error.message, kind: r.error.kind });
      data = r.data;
    } else if (source === "text") {
      const description =
        typeof body.description === "string" ? body.description.trim() : "";
      if (description.length < 10) {
        return json(400, { error: "description is required (at least a sentence)" });
      }
      if (description.length > 4000) {
        return json(400, { error: "description too long (max 4000)" });
      }
      const r = await extractFromText({ description });
      if (!r.ok) return json(422, { error: r.error.message, kind: r.error.kind });
      data = r.data;
    } else {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!/^https?:\/\//i.test(url)) {
        return json(400, { error: "url must start with http(s)://" });
      }
      const scraped = await orchestrate({ url });
      const result = scraped.result;
      if (!result) {
        return json(422, { error: scrapeErrorMessage(scraped.finalError) });
      }
      if (result.screenshot) {
        const r = await extractFromImage({
          image: result.screenshot,
          mime: "image/jpeg",
        });
        if (!r.ok) return json(422, { error: r.error.message, kind: r.error.kind });
        data = r.data;
      } else {
        const description = htmlToText(result.html).slice(0, 4000);
        if (description.length < 10) {
          return json(422, { error: "couldn't read enough from that page" });
        }
        const r = await extractFromText({ description });
        if (!r.ok) return json(422, { error: r.error.message, kind: r.error.kind });
        data = r.data;
      }
    }

    return json(200, { ok: true, data, source });
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : "extraction failed",
    });
  }
}

function decodeImage(v: unknown): Buffer | null {
  if (typeof v !== "string" || v.length === 0) return null;
  const stripped = v.replace(/^data:image\/(jpeg|png);base64,/, "");
  try {
    const buf = Buffer.from(stripped, "base64");
    return buf.byteLength > 0 ? buf : null;
  } catch {
    return null;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scrapeErrorMessage(e?: ScrapeError): string {
  if (!e) return "couldn't open that link";
  switch (e.kind) {
    case "invalid-url":
      return "that doesn't look like a valid URL";
    case "ssrf-blocked":
      return "that URL isn't allowed";
    case "non-html":
      return "that link isn't a web page";
    case "blocked":
      return "the site blocked us — try a screenshot instead";
    case "timeout":
      return "the site took too long — try a screenshot instead";
    case "too-large":
      return "that page is too big";
    default:
      return "couldn't read that page — try a screenshot instead";
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
