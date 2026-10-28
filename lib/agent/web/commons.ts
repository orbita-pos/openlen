/**
 * WIKIMEDIA COMMONS, READ FOR `image_search` (spec local 2026-10-27-chat-drop-and-images, Part B).
 *
 * Commons is free, needs no key, and every file on it has a free license with its author: what a
 * photo in the chat (and on a page) must show. This is the pure half — the search URL, the answer
 * turned into photos, and the credit line; the tool fetches and stores (`image-search.ts`).
 *
 * The API answer, probed 2026-10-27: `query.pages[]` with `index` (the search order) and
 * `imageinfo[0]` = `thumburl`/`thumbwidth`/`thumbheight`/`descriptionurl`/`mime` and
 * `extmetadata.{Artist,LicenseShortName,LicenseUrl,ImageDescription}.value`, where Artist and
 * ImageDescription are HTML.
 */

export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
/** The thumbnail width asked for: big enough for the lightbox, small enough to copy. */
export const COMMONS_THUMB_WIDTH = 960;
/** What the chat shows and `/api/upload` would take: no SVG, TIFF, PDF pages or sounds. */
const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_DESCRIPTION = 200;

export interface CommonsPhoto {
  readonly title: string;
  readonly thumbUrl: string;
  readonly width: number;
  readonly height: number;
  readonly mime: string;
  readonly author: string;
  readonly license: string;
  readonly licenseUrl: string | null;
  readonly pageUrl: string;
  readonly description: string;
}

export function commonsSearchUrl(query: string, limit: number): string {
  const p = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(COMMONS_THUMB_WIDTH),
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|ImageDescription",
  });
  return `${COMMONS_API}?${p.toString()}`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Commons' HTML (a link to the author's page, a span) as the text a person reads. */
function plainText(html: unknown): string {
  if (typeof html !== "string") return "";
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      const lower = e.toLowerCase();
      if (ENTITIES[lower] !== undefined) return ENTITIES[lower]!;
      if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
      return m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Commons adds `utm_*` to its URLs; a copy of the photo doesn't need them. */
function withoutTracking(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return raw;
  }
}

const meta = (m: unknown, key: string): string => plainText((m as Record<string, { value?: unknown } | undefined> | undefined)?.[key]?.value);

/** The photos of an answer, in the search's order; anything unexpected is left out, never thrown. */
export function photosFromCommons(body: unknown): CommonsPhoto[] {
  const pages = (body as { query?: { pages?: unknown } } | null)?.query?.pages;
  if (!Array.isArray(pages)) return [];
  const ordered = [...pages].sort((a, b) => Number((a as { index?: unknown })?.index ?? 0) - Number((b as { index?: unknown })?.index ?? 0));
  const out: CommonsPhoto[] = [];
  for (const page of ordered) {
    const info = (page as { imageinfo?: unknown[] } | null)?.imageinfo?.[0] as Record<string, unknown> | undefined;
    if (!info || typeof info.mime !== "string" || !PHOTO_MIMES.has(info.mime)) continue;
    const thumb = typeof info.thumburl === "string" ? info.thumburl : null;
    const pageUrl = typeof info.descriptionurl === "string" ? info.descriptionurl : null;
    if (!thumb || !pageUrl) continue;
    const rawTitle = typeof (page as { title?: unknown }).title === "string" ? (page as { title: string }).title : "";
    const m = info.extmetadata;
    const licenseUrl = meta(m, "LicenseUrl");
    const description = meta(m, "ImageDescription");
    out.push({
      title: rawTitle.replace(/^File:/, "").replace(/\.[^.]+$/, ""),
      thumbUrl: withoutTracking(thumb),
      width: Number(info.thumbwidth) || 0,
      height: Number(info.thumbheight) || 0,
      mime: info.mime,
      author: meta(m, "Artist") || "Unknown author",
      license: meta(m, "LicenseShortName") || "See the Commons page",
      licenseUrl: licenseUrl || null,
      pageUrl,
      description: description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1)}…` : description,
    });
  }
  return out;
}

/** The line that goes next to the photo, in the chat and on a page. */
export function creditLine(p: Pick<CommonsPhoto, "author" | "license">): string {
  return `Photo: ${p.author}, ${p.license}, via Wikimedia Commons`;
}
