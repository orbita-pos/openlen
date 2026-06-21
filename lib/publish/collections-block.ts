// Publish-time bake of the Collections module. UNLIKE bookings/comments this
// emits STATIC HTML (no JS, no Shadow DOM, no runtime API): a grid or list of
// item cards rendered server-side from the owner's items. Born-100: fully
// edge-cacheable, SEO-crawlable, and CSP-clean (style-src is unset — inline
// styles are load-bearing; we add NO inline script, so the seal is untouched).
//
// Placement: a `data-ol-collection-section` placeholder (dropped from the
// Módulos panel) is REPLACED by the grid; otherwise the grid is appended before
// </body>. Re-baked from the DB on every publish (creator content, not
// per-visitor) — there is no client fetch.
//
// SECURITY: every dynamic value is HTML-escaped HERE — static mode has no
// client textContent safety net. ctaUrl/imageUrl were scheme-allow-listed at
// the API (lib/collections/item-input.ts); we escape again for the attribute.

import { detectSiteAccent } from "@/lib/members/site-accent";
import type { ItemRow } from "@/lib/collections/store";

const WIDGET_MARKER = "data-ol-collection-widget";
const SECTION_MARKER = "data-ol-collection-section";

const FALLBACK_ACCENT = "#16181d";
const CARD_BORDER = "#ececf0";
const INK = "#16181d";
const MUTED = "#6b7280";

export interface CollectionsBakeConfig {
  items: ItemRow[];
  layout: "grid" | "list";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Readable text color on an accent background (luminance threshold). */
function inkOn(accent: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(accent.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? "#16181d" : "#ffffff";
}

function badgeHtml(badge: string | null, accent: string): string {
  if (!badge) return "";
  return `<span style="align-self:flex-start;font-size:11px;font-weight:600;letter-spacing:.02em;padding:3px 9px;border-radius:999px;background:#f3f3f6;color:${accent};">${esc(badge)}</span>`;
}

function ctaHtml(item: ItemRow, accent: string): string {
  if (!item.ctaLabel || !item.ctaUrl) return "";
  return `<a href="${esc(item.ctaUrl)}" style="margin-top:auto;align-self:flex-start;display:inline-block;text-decoration:none;font-size:13px;font-weight:600;padding:9px 16px;border-radius:10px;background:${accent};color:${inkOn(accent)};">${esc(item.ctaLabel)}</a>`;
}

function gridCard(item: ItemRow, accent: string): string {
  const img = item.imageUrl
    ? `<img src="${esc(item.imageUrl)}" alt="${esc(item.title)}" loading="lazy" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#f4f4f6;">`
    : "";
  return `<article style="border:1px solid ${CARD_BORDER};border-radius:14px;overflow:hidden;background:#fff;display:flex;flex-direction:column;">${img}<div style="padding:16px;display:flex;flex-direction:column;gap:7px;flex:1;">${badgeHtml(item.badge, accent)}<h3 style="margin:0;font-size:16px;font-weight:700;line-height:1.3;color:${INK};">${esc(item.title)}</h3>${item.subtitle ? `<div style="font-size:13px;color:${MUTED};">${esc(item.subtitle)}</div>` : ""}${item.priceDisplay ? `<div style="font-size:15px;font-weight:700;color:${accent};">${esc(item.priceDisplay)}</div>` : ""}${item.description ? `<p style="margin:0;font-size:13.5px;line-height:1.55;color:#52525b;">${esc(item.description)}</p>` : ""}${ctaHtml(item, accent)}</div></article>`;
}

function listRow(item: ItemRow, accent: string): string {
  const thumb = item.imageUrl
    ? `<img src="${esc(item.imageUrl)}" alt="${esc(item.title)}" loading="lazy" style="width:84px;height:84px;flex:0 0 auto;object-fit:cover;border-radius:10px;background:#f4f4f6;">`
    : "";
  return `<div style="display:flex;gap:16px;padding:16px 0;border-bottom:1px solid ${CARD_BORDER};align-items:flex-start;">${thumb}<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;"><div style="display:flex;justify-content:space-between;gap:14px;align-items:baseline;"><h3 style="margin:0;font-size:16px;font-weight:700;line-height:1.3;color:${INK};">${esc(item.title)}</h3>${item.priceDisplay ? `<span style="flex:0 0 auto;font-size:15px;font-weight:700;color:${accent};">${esc(item.priceDisplay)}</span>` : ""}</div>${badgeHtml(item.badge, accent)}${item.subtitle ? `<div style="font-size:13px;color:${MUTED};">${esc(item.subtitle)}</div>` : ""}${item.description ? `<p style="margin:0;font-size:13.5px;line-height:1.55;color:#52525b;">${esc(item.description)}</p>` : ""}${ctaHtml(item, accent)}</div></div>`;
}

function container(cfg: CollectionsBakeConfig, accent: string): string {
  if (cfg.layout === "list") {
    const rows = cfg.items.map((it) => listRow(it, accent)).join("");
    return `<div ${WIDGET_MARKER} style="max-width:680px;margin:32px auto;padding:0 16px;">${rows}</div>`;
  }
  const cards = cfg.items.map((it) => gridCard(it, accent)).join("");
  return `<div ${WIDGET_MARKER} style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px;max-width:1100px;margin:32px auto;padding:0 16px;">${cards}</div>`;
}

/** Bake the collection grid/list into the page. Idempotent. Replaces the
 *  data-ol-collection-section placeholder, else appends before </body>. With no
 *  items it just clears the placeholder (so the dashed editor box never ships). */
export function bakeCollections(html: string, cfg: CollectionsBakeConfig): string {
  if (html.includes(WIDGET_MARKER)) return html;

  const accent = detectSiteAccent(html) ?? FALLBACK_ACCENT;
  const block = cfg.items.length ? container(cfg, accent) : `<div ${WIDGET_MARKER}></div>`;

  const markerRe = new RegExp(
    `<(section|div)[^>]*\\b${SECTION_MARKER}\\b[^>]*>[\\s\\S]*?<\\/\\1>`,
    "i",
  );
  if (markerRe.test(html)) {
    return html.replace(markerRe, () => block);
  }
  if (!cfg.items.length) return html;

  const idx = html.lastIndexOf("</body>");
  return idx === -1 ? html + block : html.slice(0, idx) + block + html.slice(idx);
}
