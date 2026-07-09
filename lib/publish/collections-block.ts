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
import { parsePriceCents } from "@/lib/publish/orders-price";

const WIDGET_MARKER = "data-ol-collection-widget";
const SECTION_MARKER = "data-ol-collection-section";

const FALLBACK_ACCENT = "#16181d";
const CARD_BORDER = "#ececf0";
const INK = "#16181d";
const MUTED = "#6b7280";

export interface CollectionsBakeConfig {
  items: ItemRow[];
  layout: "grid" | "list";
  /** Pedidos por WhatsApp: cuando viene con número, cada tarjeta hornea el
   *  botón «Agregar» (data-ol-order-add) que el runtime del carrito opera.
   *  null/ausente = off → salida byte-idéntica a la histórica. */
  orders?: { number: string } | null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Scheme allow-lists — the API already validates these, but a row written
// directly to the DB must NOT inject a javascript:/data: URL into href/src.
// `/(?!/)` rejects protocol-relative `//evil.com`.
const SAFE_HREF_RE = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;
const SAFE_IMG_RE = /^(https?:\/\/|\/(?!\/))/i;
function safeHref(s: string | null): string | null {
  return s && SAFE_HREF_RE.test(s.trim()) ? s : null;
}
function safeImg(s: string | null): string | null {
  return s && SAFE_IMG_RE.test(s.trim()) ? s : null;
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
  const href = safeHref(item.ctaUrl);
  if (!item.ctaLabel || !href) return "";
  return `<a href="${esc(href)}" style="margin-top:auto;align-self:flex-start;display:inline-block;text-decoration:none;font-size:13px;font-weight:600;padding:9px 16px;border-radius:10px;background:${accent};color:${inkOn(accent)};">${esc(item.ctaLabel)}</a>`;
}

function orderButtonHtml(item: ItemRow, accent: string, label: string, hasCta: boolean): string {
  const cents = parsePriceCents(item.priceDisplay);
  return `<button type="button" data-ol-order-add data-ol-order-id="${esc(item.id)}" data-ol-order-title="${esc(item.title)}" data-ol-order-price="${esc(item.priceDisplay ?? "")}" data-ol-order-cents="${cents ?? ""}" style="${hasCta ? "margin-top:8px" : "margin-top:auto"};align-self:flex-start;display:inline-block;cursor:pointer;font-size:13px;font-weight:600;padding:8px 15px;border-radius:10px;border:1.5px solid ${accent};background:transparent;color:${accent};">${esc(label)}</button>`;
}

function gridCard(
  item: ItemRow,
  accent: string,
  orders: { number: string } | null | undefined,
  addLabel: string,
): string {
  const src = safeImg(item.imageUrl);
  const img = src
    ? `<img src="${esc(src)}" alt="${esc(item.title)}" loading="lazy" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#f4f4f6;">`
    : "";
  return `<article style="border:1px solid ${CARD_BORDER};border-radius:14px;overflow:hidden;background:#fff;display:flex;flex-direction:column;">${img}<div style="padding:16px;display:flex;flex-direction:column;gap:7px;flex:1;">${badgeHtml(item.badge, accent)}<h3 style="margin:0;font-size:16px;font-weight:700;line-height:1.3;color:${INK};">${esc(item.title)}</h3>${item.subtitle ? `<div style="font-size:13px;color:${MUTED};">${esc(item.subtitle)}</div>` : ""}${item.priceDisplay ? `<div style="font-size:15px;font-weight:700;color:${accent};">${esc(item.priceDisplay)}</div>` : ""}${item.description ? `<p style="margin:0;font-size:13.5px;line-height:1.55;color:#52525b;">${esc(item.description)}</p>` : ""}${ctaHtml(item, accent)}${orders ? orderButtonHtml(item, accent, addLabel, Boolean(item.ctaLabel && safeHref(item.ctaUrl))) : ""}</div></article>`;
}

function listRow(
  item: ItemRow,
  accent: string,
  orders: { number: string } | null | undefined,
  addLabel: string,
): string {
  const src = safeImg(item.imageUrl);
  const thumb = src
    ? `<img src="${esc(src)}" alt="${esc(item.title)}" loading="lazy" style="width:84px;height:84px;flex:0 0 auto;object-fit:cover;border-radius:10px;background:#f4f4f6;">`
    : "";
  return `<div style="display:flex;gap:16px;padding:16px 0;border-bottom:1px solid ${CARD_BORDER};align-items:flex-start;">${thumb}<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;"><div style="display:flex;justify-content:space-between;gap:14px;align-items:baseline;"><h3 style="margin:0;font-size:16px;font-weight:700;line-height:1.3;color:${INK};">${esc(item.title)}</h3>${item.priceDisplay ? `<span style="flex:0 0 auto;font-size:15px;font-weight:700;color:${accent};">${esc(item.priceDisplay)}</span>` : ""}</div>${badgeHtml(item.badge, accent)}${item.subtitle ? `<div style="font-size:13px;color:${MUTED};">${esc(item.subtitle)}</div>` : ""}${item.description ? `<p style="margin:0;font-size:13.5px;line-height:1.55;color:#52525b;">${esc(item.description)}</p>` : ""}${ctaHtml(item, accent)}${orders ? orderButtonHtml(item, accent, addLabel, Boolean(item.ctaLabel && safeHref(item.ctaUrl))) : ""}</div></div>`;
}

function container(cfg: CollectionsBakeConfig, accent: string, addLabel: string): string {
  if (cfg.layout === "list") {
    const rows = cfg.items.map((it) => listRow(it, accent, cfg.orders, addLabel)).join("");
    return `<div ${WIDGET_MARKER} style="max-width:680px;margin:32px auto;padding:0 16px;">${rows}</div>`;
  }
  const cards = cfg.items.map((it) => gridCard(it, accent, cfg.orders, addLabel)).join("");
  return `<div ${WIDGET_MARKER} style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px;max-width:1100px;margin:32px auto;padding:0 16px;">${cards}</div>`;
}

/** Bake the collection grid/list into the page. Idempotent. Replaces the
 *  data-ol-collection-section placeholder, else appends before </body>. With no
 *  items it just clears the placeholder (so the dashed editor box never ships). */
export function bakeCollections(
  html: string,
  cfg: CollectionsBakeConfig,
  allowAppend = true,
): string {
  if (html.includes(WIDGET_MARKER)) return html;

  const accent = detectSiteAccent(html) ?? FALLBACK_ACCENT;
  const addLabel = /<html[^>]*\blang=["']?en/i.test(html) ? "Add" : "Agregar";
  const block = cfg.items.length ? container(cfg, accent, addLabel) : `<div ${WIDGET_MARKER}></div>`;

  // Replace the editor placeholder wherever it sits (any page). With no items
  // the block is an empty widget div, so the dashed editor box never ships —
  // even when the module is disabled (the bake is still called to strip it).
  const markerRe = new RegExp(
    `<(section|div)[^>]*\\b${SECTION_MARKER}\\b[^>]*>[\\s\\S]*?<\\/\\1>`,
    "i",
  );
  if (markerRe.test(html)) {
    return html.replace(markerRe, () => block);
  }
  // No placeholder: only the home/primary document auto-appends the grid, and
  // only when there are items — never blanket-append the heavy grid onto every
  // subpage of a multi-page site.
  if (cfg.items.length && allowAppend) {
    const idx = html.lastIndexOf("</body>");
    return idx === -1 ? html + block : html.slice(0, idx) + block + html.slice(idx);
  }
  return html;
}
