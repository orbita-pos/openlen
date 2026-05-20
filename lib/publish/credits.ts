// ─────────────────────────────────────────────────────────────────────────────
// Unsplash credit consolidation — defense-in-depth attribution at publish.
//
// The editor inserts a visible `<span data-openlen-credit="unsplash">` next to
// every Unsplash image picked via the search tab (see use-image-replace.ts).
// That satisfies Unsplash's "visible credit" guideline for the picker flow.
// BUT three failure modes break that single line of defense:
//
//   1. A user CSS rule (or manual chat edit) can hide / remove the inline
//      credit while leaving the photo on the page.
//   2. Pasted-URL Unsplash images (PasteUrlTab in replace-asset-modal) never
//      get an attribution span at all.
//   3. Curated templates and pasted-HTML projects may hard-code
//      images.unsplash.com URLs without any credit DOM.
//
// To stay TOS-compliant regardless, at publish time we scan the HTML and:
//
//   - Inject one `<meta name="image-source">` per detected photographer in
//     <head> — machine-readable, never visually hidden, survives any CSS.
//   - Inject one sr-only `<aside data-openlen-credits-aggregate>` at the end
//     of <body> with a `<ul>` of every credit + a generic "Photos from
//     Unsplash" line when anonymous CDN URLs are detected.
//
// The aside is screen-reader-accessible (positive a11y win) and lives in the
// DOM where Unsplash's own crawler / TOS audit can pick it up reliably.
//
// Idempotent: re-running on already-consolidated HTML strips the prior
// aggregate block (matched by data-openlen-credits-aggregate) and prior
// meta tags (matched by name="image-source"), then writes fresh ones from
// the current state — so removing a photo from the page also removes its
// credit on next publish.
// ─────────────────────────────────────────────────────────────────────────────

import * as cheerio from "cheerio";

export interface UnsplashCredit {
  author: string;
  authorUrl: string;
}

export interface ConsolidationResult {
  html: string;
  /** Distinct photographers attributed via inline credit spans. */
  credits: UnsplashCredit[];
  /** Number of images.unsplash.com images that had no adjacent credit span
   *  (paste-URL or template-baked). Aggregated as a generic Unsplash mention. */
  anonymousUnsplashCount: number;
}

const UTM = "?utm_source=openlen&utm_medium=referral";
const UNSPLASH_HOME = `https://unsplash.com/${UTM}`;
const UNSPLASH_CDN_RE = /https?:\/\/images\.unsplash\.com\//i;

export function consolidateUnsplashCredits(html: string): ConsolidationResult {
  if (!html || html.trim().length === 0) {
    return { html, credits: [], anonymousUnsplashCount: 0 };
  }

  const $ = cheerio.load(html);

  // Strip any prior consolidation artifacts so this stays idempotent across
  // re-publishes — the credit set must reflect the current image set, not
  // accumulate forever.
  $("[data-openlen-credits-aggregate]").remove();
  $("head meta[name='image-source']").remove();

  // Harvest distinct photographers from inline credit spans. Dedup by
  // author URL so the same photo applied twice doesn't credit twice.
  const seen = new Map<string, UnsplashCredit>();
  $("[data-openlen-credit='unsplash']").each((_, el) => {
    const anchors = $(el).find("a");
    if (anchors.length === 0) return;
    const authorAnchor = anchors.eq(0);
    const author = authorAnchor.text().trim();
    const authorUrl = (authorAnchor.attr("href") ?? "").trim();
    if (!author || !authorUrl) return;
    if (seen.has(authorUrl)) return;
    seen.set(authorUrl, { author, authorUrl });
  });

  // Count anonymous Unsplash images — CDN URL with no immediately-adjacent
  // credit span. Conservative: only checks the very next sibling because
  // that's where use-image-replace.ts pins ours; a paste-URL flow has no
  // sibling at all so this picks it up. Re-running consolidation after a
  // template-baked image gets re-published also stays stable here.
  let anonymousUnsplashCount = 0;
  $("img").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    if (!UNSPLASH_CDN_RE.test(src)) return;
    const next = $(el).next();
    if (next.length > 0 && next.attr("data-openlen-credit") === "unsplash") return;
    anonymousUnsplashCount += 1;
  });

  const credits = Array.from(seen.values());
  if (credits.length === 0 && anonymousUnsplashCount === 0) {
    return { html, credits, anonymousUnsplashCount };
  }

  const head = $("head").first();
  if (head.length > 0) {
    for (const c of credits) {
      head.append(
        `<meta name="image-source" content="${escapeAttr(c.author)} via Unsplash (${escapeAttr(c.authorUrl)})">`,
      );
    }
    if (anonymousUnsplashCount > 0) {
      head.append(
        `<meta name="image-source" content="Anonymous Unsplash photo(s) (${anonymousUnsplashCount}) via ${UNSPLASH_HOME}">`,
      );
    }
  }

  const body = $("body").first();
  if (body.length > 0) {
    const items: string[] = credits.map(
      (c) =>
        `<li>Photo by <a href="${escapeAttr(c.authorUrl)}" rel="noopener">${escapeHtml(c.author)}</a> on <a href="${UNSPLASH_HOME}" rel="noopener">Unsplash</a></li>`,
    );
    if (anonymousUnsplashCount > 0) {
      items.push(
        `<li>Additional photo(s) from <a href="${UNSPLASH_HOME}" rel="noopener">Unsplash</a></li>`,
      );
    }
    body.append(
      `<aside data-openlen-credits-aggregate aria-label="Image credits" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0"><h2 style="font-size:1em;margin:0">Image credits</h2><ul style="margin:0;padding:0;list-style:none">${items.join("")}</ul></aside>`,
    );
  }

  return {
    html: $.html(),
    credits,
    anonymousUnsplashCount,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
