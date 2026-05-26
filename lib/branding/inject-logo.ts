// Inject the per-project logo into a publish-ready HTML document.
//
// - Replaces any existing <link rel="icon" …> with one pointing at the
//   resolved logo URL. Apple-touch / mask-icon variants are left alone.
// - Injects <meta property="og:image" content="…"> when no og:image is
//   already declared in the document. The user's own og:image always wins.
//
// Soft-fails: any parse error short-circuits to the original HTML.

import * as cheerio from "cheerio";

export interface InjectLogoParams {
  html: string;
  logoUrl: string;
}

export function injectLogoIntoHtml({ html, logoUrl }: InjectLogoParams): string {
  if (!html || !logoUrl) return html;
  let $: ReturnType<typeof cheerio.load>;
  try {
    $ = cheerio.load(html);
  } catch {
    return html;
  }

  let head = $("head");
  if (head.length === 0) {
    // Headless body — synthesize a <head> so the inject still works.
    $("html").prepend("<head></head>");
    head = $("head");
    if (head.length === 0) return html;
  }

  // 1. Favicon — match rel="icon", "shortcut icon", and the bare "icon"
  // variants (NOT apple-touch-icon, which is its own thing).
  const iconLinks = head.find("link[rel]").filter((_, el) => {
    const rel = ($(el).attr("rel") || "").toLowerCase();
    if (!rel) return false;
    const tokens = rel.split(/\s+/);
    return tokens.some((t) => t === "icon" || t === "shortcut");
  });
  iconLinks.remove();
  head.append(`<link rel="icon" href="${escapeAttr(logoUrl)}" />`);

  // 2. og:image — only inject if absent AND the URL is something social
  // crawlers can actually fetch. data: URIs (e.g. the auto-generated SVG
  // default) are valid favicons but Facebook / X / LinkedIn won't render
  // them, so we leave og:image untouched in that case rather than ship a
  // broken share preview.
  const existingOg = head.find('meta[property="og:image"]');
  if (existingOg.length === 0 && !/^data:/i.test(logoUrl)) {
    head.append(
      `<meta property="og:image" content="${escapeAttr(logoUrl)}" />`,
    );
  }

  return $.html();
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
