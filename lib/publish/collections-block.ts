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

import { detectSiteAccent } from "@/lib/publish/site-accent";
import type { ItemRow } from "@/lib/collections/store";
import { inkOn } from "@/lib/publish/color-utils";
import { fillCollectionTemplate } from "@/lib/publish/collection-template";

const WIDGET_MARKER = "data-ol-collection-widget";
const SECTION_MARKER = "data-ol-collection-section";

const FALLBACK_ACCENT = "#16181d";

// Paleta de SUPERFICIE. El acento se detecta de la página (detectSiteAccent) y
// siempre se respetó; lo que faltaba era esto: las superficies estaban escritas
// a mano en claro, así que un catálogo sobre una página oscura salía en tarjetas
// blancas — el único módulo con banda sin noción de tema (chat/comments/bookings
// ya lo tenían). Los valores oscuros son los MISMOS de comments-widget.ts para
// que dos módulos en la misma página no se vean de dos sitios distintos.
interface Palette {
  ink: string;
  muted: string;
  desc: string;
  card: string;
  cardShadow: string;
  hoverShadow: string;
  badgeOver: string;
  badgeFlat: string;
  imgBg: string;
  rowBorder: string;
}

const LIGHT: Palette = {
  ink: "#16181d",
  muted: "#6b7280",
  desc: "#52525b",
  card: "#fff",
  cardShadow: "0 2px 6px rgba(23,18,14,.06),0 12px 28px rgba(23,18,14,.07)",
  hoverShadow: "0 4px 10px rgba(23,18,14,.08),0 20px 44px rgba(23,18,14,.12)",
  badgeOver: "#fff",
  badgeFlat: "#f3f3f6",
  imgBg: "#f4f4f6",
  rowBorder: "rgba(0,0,0,.06)",
};

// En oscuro la sombra difusa no se ve: el borde lo da un anillo con box-shadow
// (no `border`, que sí movería el layout y rompería la paridad con el claro).
const DARK: Palette = {
  ink: "#e8e8ea",
  muted: "#9aa0a8",
  desc: "#b3b9c1",
  card: "#1c1f24",
  cardShadow: "0 0 0 1px #33363c,0 12px 28px rgba(0,0,0,.45)",
  hoverShadow: "0 0 0 1px #3d4148,0 20px 44px rgba(0,0,0,.55)",
  badgeOver: "#1c1f24",
  badgeFlat: "#26292f",
  imgBg: "#1c1f24",
  rowBorder: "rgba(255,255,255,.09)",
};

function paletteFor(theme: "light" | "dark" | undefined): Palette {
  return theme === "dark" ? DARK : LIGHT;
}

export interface CollectionsBakeConfig {
  items: ItemRow[];
  layout: "grid" | "list";
  /** Pedidos por WhatsApp: cuando viene con número, cada tarjeta hornea el
   *  botón «Agregar» (data-ol-order-add) que el runtime del carrito opera.
   *  null/ausente = off → salida byte-idéntica a la histórica. */
  /** settings.collections.theme — mismo patrón que comments/bookings/chat.
   *  Ausente o "light" → salida byte-idéntica a la histórica. */
  theme?: "light" | "dark";
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


function badgeHtml(badge: string | null, accent: string, overImage: boolean, p: Palette): string {
  if (!badge) return "";
  if (overImage) {
    return `<span style="position:absolute;top:10px;left:10px;font-size:11px;font-weight:700;letter-spacing:.02em;padding:4px 10px;border-radius:999px;background:${p.badgeOver};color:${accent};box-shadow:0 2px 8px rgba(0,0,0,.12);">${esc(badge)}</span>`;
  }
  return `<span style="align-self:flex-start;font-size:11px;font-weight:600;letter-spacing:.02em;padding:3px 9px;border-radius:999px;background:${p.badgeFlat};color:${accent};">${esc(badge)}</span>`;
}

function ctaHtml(item: ItemRow, accent: string, fullWidth: boolean): string {
  const href = safeHref(item.ctaUrl);
  if (!item.ctaLabel || !href) return "";
  if (fullWidth) {
    return `<a href="${esc(href)}" style="margin-top:12px;display:block;text-align:center;text-decoration:none;font-size:14px;font-weight:700;padding:11px 0;border-radius:999px;border:1.5px solid ${accent};background:transparent;color:${accent};">${esc(item.ctaLabel)}</a>`;
  }
  return `<a href="${esc(href)}" style="margin-top:auto;align-self:flex-start;display:inline-block;text-decoration:none;font-size:13px;font-weight:600;padding:9px 16px;border-radius:999px;background:${accent};color:${inkOn(accent)};">${esc(item.ctaLabel)}</a>`;
}


/** Foto 4:3, o —clave para catálogos nacidos de un Sheet sin fotos— un
 *  placeholder con gradiente del acento + la inicial del item, para que una
 *  tarjeta sin imagen se vea intencional y no como caja de texto vacía. */
function mediaHtml(item: ItemRow, accent: string, p: Palette): string {
  const src = safeImg(item.imageUrl);
  // El gradiente del placeholder es el acento con ALFA (1f/40), así que compone
  // sobre la tarjeta: en claro daba rosa pálido sobre #fff y en oscuro da el
  // mismo acento apagado sobre #1c1f24. Por eso no lleva rama de tema.
  const media = src
    ? `<img src="${esc(src)}" alt="${esc(item.title)}" loading="lazy" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:${p.imgBg};">`
    : `<div aria-hidden="true" style="width:100%;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,${accent}1f,${accent}40);color:${accent};font-size:54px;font-weight:800;font-family:Georgia,'Times New Roman',serif;">${esc((item.title.trim().charAt(0) || "•").toUpperCase())}</div>`;
  return `<div style="position:relative;">${media}${badgeHtml(item.badge, accent, true, p)}</div>`;
}

function gridCard(
  item: ItemRow,
  accent: string,
  p: Palette,
): string {
  const hasCta = Boolean(item.ctaLabel && safeHref(item.ctaUrl));
  const price = item.priceDisplay
    ? `<div style="flex:0 0 auto;font-size:17px;font-weight:800;letter-spacing:-.01em;color:${accent};">${esc(item.priceDisplay)}</div>`
    : "";
  return `<article class="olc-card" style="border:0;border-radius:18px;overflow:hidden;background:${p.card};display:flex;flex-direction:column;box-shadow:${p.cardShadow};">${mediaHtml(item, accent, p)}<div style="padding:15px 16px 16px;display:flex;flex-direction:column;gap:6px;flex:1;"><div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;"><h3 style="margin:0;font-size:16.5px;font-weight:700;line-height:1.25;color:${p.ink};">${esc(item.title)}</h3>${price}</div>${item.subtitle ? `<div style="font-size:12.5px;color:${p.muted};">${esc(item.subtitle)}</div>` : ""}${item.description ? `<p style="margin:0;font-size:13.5px;line-height:1.5;color:${p.desc};display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(item.description)}</p>` : ""}${ctaHtml(item, accent, true)}</div></article>`;
}

function listRow(
  item: ItemRow,
  accent: string,
  p: Palette,
): string {
  const src = safeImg(item.imageUrl);
  const thumb = src
    ? `<img src="${esc(src)}" alt="${esc(item.title)}" loading="lazy" style="width:84px;height:84px;flex:0 0 auto;object-fit:cover;border-radius:14px;background:${p.imgBg};">`
    : `<div aria-hidden="true" style="width:84px;height:84px;flex:0 0 auto;border-radius:14px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,${accent}1f,${accent}40);color:${accent};font-size:26px;font-weight:800;font-family:Georgia,'Times New Roman',serif;">${esc((item.title.trim().charAt(0) || "•").toUpperCase())}</div>`;
  return `<div style="display:flex;gap:16px;padding:16px 0;border-bottom:1px solid ${p.rowBorder};align-items:flex-start;">${thumb}<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;"><div style="display:flex;justify-content:space-between;gap:14px;align-items:baseline;"><h3 style="margin:0;font-size:16px;font-weight:700;line-height:1.3;color:${p.ink};">${esc(item.title)}</h3>${item.priceDisplay ? `<span style="flex:0 0 auto;font-size:16px;font-weight:800;letter-spacing:-.01em;color:${accent};">${esc(item.priceDisplay)}</span>` : ""}</div>${badgeHtml(item.badge, accent, false, p)}${item.subtitle ? `<div style="font-size:13px;color:${p.muted};">${esc(item.subtitle)}</div>` : ""}${item.description ? `<p style="margin:0;font-size:13.5px;line-height:1.55;color:${p.desc};">${esc(item.description)}</p>` : ""}${ctaHtml(item, accent, false)}</div></div>`;
}

function container(cfg: CollectionsBakeConfig, accent: string): string {
  const p = paletteFor(cfg.theme);
  if (cfg.layout === "list") {
    const rows = cfg.items.map((it) => listRow(it, accent, p)).join("");
    return `<div ${WIDGET_MARKER} style="max-width:680px;margin:32px auto;padding:0 16px;">${rows}</div>`;
  }
  const cards = cfg.items.map((it) => gridCard(it, accent, p)).join("");
  // El hover (lift) no puede ser inline — va en un <style> mínimo, scoped al
  // marker (CSP-clean: style-src no se toca; cero JS). Los estilos de las
  // tarjetas siguen INLINE a propósito: ganan en especificidad a cualquier
  // regla global de la página del usuario (article{...}, img{...}).
  const hover = `<style>[${WIDGET_MARKER}] .olc-card{transition:transform .18s ease,box-shadow .18s ease}[${WIDGET_MARKER}] .olc-card:hover{transform:translateY(-3px);box-shadow:${p.hoverShadow}}@media (prefers-reduced-motion:reduce){[${WIDGET_MARKER}] .olc-card,[${WIDGET_MARKER}] .olc-card:hover{transition:none;transform:none}}</style>`;
  return `<div ${WIDGET_MARKER} style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px;max-width:1100px;margin:32px auto;padding:0 16px;">${hover}${cards}</div>`;
}

/** The widget markup alone, WITHOUT touching the document — the editor-canvas
 *  preview places it inside the band itself (replacing the persisted band, as
 *  bakeCollections does, would delete it from data.html on the next save). */
export function renderCollectionsWidget(html: string, cfg: CollectionsBakeConfig): string {
  if (!cfg.items.length) return "";
  const accent = detectSiteAccent(html) ?? FALLBACK_ACCENT;
  const addLabel = /<html[^>]*\blang=["']?en/i.test(html) ? "Add" : "Agregar";
  return container(cfg, accent);
}

/** Bake the collection grid/list into the page. Idempotent. Replaces the
 *  data-ol-collection-section placeholder, else appends before </body>. With no
 *  items it just clears the placeholder (so the dashed editor box never ships).
 *
 *  RUTA PREFERENTE: si la página trae tarjetas marcadas por el modelo
 *  (`data-ol-item`), se repiten ÉSAS y esta rejilla no llega a dibujarse — el
 *  gusto lo pone la página, no nosotros. Todo lo de abajo es la ruta de las
 *  páginas anteriores a ese contrato, que sólo llevan el hueco vacío. */
export function bakeCollections(
  html: string,
  cfg: CollectionsBakeConfig,
  allowAppend = true,
): string {
  const plantilla = fillCollectionTemplate(html, cfg.items);
  if (plantilla.touched) return plantilla.html;

  if (html.includes(WIDGET_MARKER)) return html;

  const accent = detectSiteAccent(html) ?? FALLBACK_ACCENT;
  const addLabel = /<html[^>]*\blang=["']?en/i.test(html) ? "Add" : "Agregar";
  const block = cfg.items.length ? container(cfg, accent) : `<div ${WIDGET_MARKER}></div>`;

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
