// Editor-canvas module preview — the SCRIPTLESS subset of the module bakes
// (WhatsApp FAB + collections grid), so turning a module on shows something in
// the canvas immediately instead of "nothing until publish". Script-driven
// widgets (assistant/chat/comments/bookings) stay out of the canvas on
// purpose: their runtimes create unmarked DOM at runtime, which the save
// serialization would persist as junk — they preview on /p/ and the
// open-in-new-tab surface instead, where nothing is serialized back.
//
// Persistence contract: EVERY injected node carries MODULES_PREVIEW_MARKER
// (+ data-openlen-no-edit so inline-edit ignores it), and
// stripEditorInstrumentation removes the marker on every save — the injected
// preview must never reach data.html. The collections grid is inserted INSIDE
// the persisted band (never replacing it, unlike publish's bakeCollections —
// removing a replaced band on save would delete it from the user's page).

import { bakeWhatsAppButton } from "@/lib/publish/whatsapp-button";
import { renderCollectionsWidget } from "@/lib/publish/collections-block";
import { renderPlatformsBand } from "@/lib/business-profiles/platforms-band";
import { findMarkerTag } from "@/lib/publish/tag-attrs";
import { detectHtmlLang } from "@/lib/publish/language-cluster";
import type { ItemRow } from "@/lib/collections/store";
import type { BusinessProfileData } from "@/lib/business-profiles/types";

export const MODULES_PREVIEW_MARKER = "data-openlen-modules-preview";
const STAMP = `${MODULES_PREVIEW_MARKER} data-openlen-no-edit`;

export interface EditorModulesPreviewCfg {
  whatsapp?: {
    enabled?: boolean;
    number?: string;
    message?: string;
    side?: "left" | "right";
  } | null;
  /** FAB-stacking inputs — mirror publishToDir's corner math. */
  assistantOn?: boolean;
  chatFabOn?: boolean;
  musicOn?: boolean;
  collections?: {
    items: ItemRow[];
    layout: "grid" | "list";
    ordersNumber?: string | null;
    theme?: "light" | "dark";
  } | null;
  /** Links del perfil de negocio; pintan la banda de plataformas si la página
   *  lleva su marcador. Scriptless, así que sí puede vivir en el canvas. */
  platforms?: BusinessProfileData["links"] | null;
  /** Script-driven widgets can't run in the canvas — with the module on and
   *  its band present, a static SKELETON previews the shape instead, so a
   *  module page never reads as "just text". */
  bookingsOn?: boolean;
  commentsOn?: boolean;
}

const GHOST = "background:rgba(127,127,127,.16);border-radius:8px;";

function previewChip(es: boolean): string {
  return `<p style="margin:0 0 14px;text-align:center;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;opacity:.5;">${es ? "Vista previa" : "Preview"}</p>`;
}

function bookingsSkeleton(es: boolean): string {
  const days = Array.from({ length: 7 }, (_, i) =>
    `<span style="flex:1;height:34px;${i === 2 ? "background:var(--ol-accent,#FF5A36);opacity:.85;border-radius:8px;" : GHOST}"></span>`,
  ).join("");
  const slots = ["10:00", "12:30", "16:00"]
    .map((h) => `<span style="padding:8px 16px;border-radius:9999px;${GHOST}font-size:13px;opacity:.65;">${h}</span>`)
    .join("");
  return (
    `<div data-ol-bookings-skeleton ${MODULES_PREVIEW_MARKER} data-openlen-no-edit ` +
    `style="max-width:560px;margin:0 auto;padding:22px;border-radius:16px;background:rgba(127,127,127,.07);box-shadow:0 1px 2px rgba(0,0,0,.05),0 10px 30px rgba(0,0,0,.07);">` +
    previewChip(es) +
    `<div style="display:flex;gap:6px;margin-bottom:12px;">${days}</div>` +
    `<div style="display:flex;gap:8px;justify-content:center;margin-bottom:16px;">${slots}</div>` +
    `<div style="height:42px;border-radius:9999px;background:var(--ol-accent,#FF5A36);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;opacity:.9;">${es ? "Reservar" : "Book"}</div>` +
    `</div>`
  );
}

function commentsSkeleton(es: boolean): string {
  const card = (w1: number, w2: number) =>
    `<div style="display:flex;gap:10px;padding:12px 14px;border-radius:12px;background:rgba(127,127,127,.07);margin-bottom:8px;">` +
    `<span style="width:28px;height:28px;border-radius:9999px;flex:none;${GHOST}"></span>` +
    `<span style="flex:1;display:flex;flex-direction:column;gap:6px;padding-top:4px;">` +
    `<span style="width:90px;height:9px;${GHOST}"></span>` +
    `<span style="width:${w1}%;height:8px;${GHOST}"></span>` +
    `<span style="width:${w2}%;height:8px;${GHOST}"></span>` +
    `</span></div>`;
  return (
    `<div data-ol-comments-skeleton ${MODULES_PREVIEW_MARKER} data-openlen-no-edit style="max-width:560px;margin:0 auto;">` +
    previewChip(es) +
    card(86, 55) +
    card(70, 40) +
    `<div style="display:flex;gap:8px;margin-top:12px;">` +
    `<span style="flex:1;height:38px;border-radius:10px;${GHOST}"></span>` +
    `<span style="width:38px;height:38px;border-radius:10px;background:var(--ol-accent,#FF5A36);opacity:.85;"></span>` +
    `</div></div>`
  );
}

function collectionGhosts(es: boolean): string {
  const card =
    `<div style="border-radius:12px;overflow:hidden;background:rgba(127,127,127,.07);">` +
    `<div style="aspect-ratio:4/3;${GHOST}border-radius:0;"></div>` +
    `<div style="padding:12px 14px;display:flex;flex-direction:column;gap:7px;">` +
    `<span style="width:70%;height:10px;${GHOST}"></span>` +
    `<span style="width:36%;height:9px;${GHOST}"></span>` +
    `</div></div>`;
  return (
    `<div data-ol-collection-ghosts ${MODULES_PREVIEW_MARKER} data-openlen-no-edit style="max-width:1100px;margin:0 auto;">` +
    previewChip(es) +
    `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px;">${card}${card}${card}</div>` +
    `<p style="margin:14px 0 0;text-align:center;font-size:12.5px;opacity:.55;">${es ? "Agrega tus productos en Módulos → Colecciones" : "Add your products in Modules → Collections"}</p>` +
    `</div>`
  );
}

/** Insert `chunk` right after the opening tag of the element carrying
 *  `marker`. No-op when the marker isn't in the document. Usa el tokenizador
 *  compartido (lib/publish/tag-attrs), no `\b${marker}\b`: la regex ingenua
 *  también acertaba con el texto del marcador dentro del valor de otro
 *  atributo, e inyectaba el preview en un elemento ajeno. */
function injectIntoBand(html: string, marker: string, chunk: string): string {
  const hit = findMarkerTag(html, marker);
  if (!hit) return html;
  return html.slice(0, hit.contentStart) + chunk + html.slice(hit.contentStart);
}

/** Does the band's marker element have no content yet? Every OTHER module
 *  surface's marker persists EMPTY in data.html (its widget only ever
 *  renders live, at bake time) — but platforms is filled directly into
 *  data.html at seed time (seedBrandIntoHtml/fillPlatformsBand, project
 *  creation / "Aplicar a mis páginas"). injectIntoBand APPENDS rather than
 *  replaces, so calling it on an already-seeded band would stack a second,
 *  duplicate grid right beside the real one — this guard keeps the canvas
 *  preview scoped to the one case it's actually for: a band inserted after
 *  creation that hasn't been through a seed/fill pass yet. */
function bandIsEmpty(html: string, marker: string): boolean {
  const hit = findMarkerTag(html, marker);
  if (!hit) return false;
  return html.slice(hit.contentStart).trimStart().startsWith("</");
}

/** A freshly-inserted band, with its preview (grid / skeleton) ALREADY
 *  inside. The live-DOM insert path never re-derives the srcDoc (by design),
 *  so a bare band would sit empty until the next reload — instead the insert
 *  payload carries the marked preview, the save serialization strips it, and
 *  derive() re-adds it on future loads. `docHtml` supplies lang + accent. */
export function bandWithPreview(
  module: "collections" | "bookings" | "comments" | "platforms",
  bandHtml: string,
  opts: {
    docHtml: string;
    collections?: { items: ItemRow[]; layout: "grid" | "list"; ordersNumber?: string | null; theme?: "light" | "dark" } | null;
    platforms?: BusinessProfileData["links"] | null;
  },
): string {
  const es = !/<html[^>]*\blang=["']?en/i.test(opts.docHtml);
  if (module === "bookings") {
    return injectIntoBand(bandHtml, "data-ol-bookings-section", bookingsSkeleton(es));
  }
  if (module === "comments") {
    return injectIntoBand(bandHtml, "data-ol-comments-section", commentsSkeleton(es));
  }
  if (module === "platforms") {
    // Not a skeleton: the real cards render scriptless, so the band lands
    // already looking like what publish will bake. Stamped like every other
    // preview, so the save strips it and data.html keeps the empty marker
    // that fillPlatformsBand fills with fresh links at publish time.
    const grid = opts.platforms?.length
      ? renderPlatformsBand({ links: opts.platforms } as BusinessProfileData, {
          lang: detectHtmlLang(opts.docHtml) ?? "",
        })
      : "";
    if (!grid) return bandHtml;
    return injectIntoBand(
      bandHtml,
      "data-ol-platforms-section",
      `<div ${MODULES_PREVIEW_MARKER} data-openlen-no-edit>${grid}</div>`,
    );
  }
  const col = opts.collections;
  if (col?.items.length) {
    const widget = renderCollectionsWidget(opts.docHtml, {
      items: col.items,
      layout: col.layout,
      orders: col.ordersNumber ? { number: col.ordersNumber } : null,
      theme: col.theme,
    });
    const stamped = widget.replace(
      "data-ol-collection-widget",
      `data-ol-collection-widget ${STAMP}`,
    );
    return injectIntoBand(bandHtml, "data-ol-collection-section", stamped);
  }
  return injectIntoBand(bandHtml, "data-ol-collection-section", collectionGhosts(es));
}

export function injectEditorModulesPreview(
  html: string,
  cfg: EditorModulesPreviewCfg,
): string {
  let out = html;
  const es = !/<html[^>]*\blang=["']?en/i.test(html);

  const col = cfg.collections;
  if (col) {
    if (col.items.length) {
      const widget = renderCollectionsWidget(out, {
        items: col.items,
        layout: col.layout,
        orders: col.ordersNumber ? { number: col.ordersNumber } : null,
        theme: col.theme,
      });
      const bandOpen = findMarkerTag(out, "data-ol-collection-section");
      if (widget && bandOpen) {
        const stamped = widget.replace(
          "data-ol-collection-widget",
          `data-ol-collection-widget ${STAMP}`,
        );
        const at = bandOpen.contentStart;
        out = out.slice(0, at) + stamped + out.slice(at);
        // While the real grid previews, hide the band's dashed empty
        // placeholder (a DIRECT child — `>` keeps card internals unaffected).
        out = out.replace(
          "</head>",
          `<style ${MODULES_PREVIEW_MARKER}>[data-ol-collection-section] > div:empty{display:none!important}</style></head>`,
        );
      }
    } else {
      // No products yet: ghost cards instead of a dead band.
      out = injectIntoBand(out, "data-ol-collection-section", collectionGhosts(es));
    }
  }

  if (cfg.bookingsOn) {
    out = injectIntoBand(out, "data-ol-bookings-section", bookingsSkeleton(es));
  }
  if (cfg.commentsOn) {
    out = injectIntoBand(out, "data-ol-comments-section", commentsSkeleton(es));
  }

  if (cfg.platforms?.length && bandIsEmpty(out, "data-ol-platforms-section")) {
    const banda = renderPlatformsBand({ links: cfg.platforms } as BusinessProfileData, {
      lang: detectHtmlLang(out) ?? "",
    });
    if (banda) {
      out = injectIntoBand(
        out,
        "data-ol-platforms-section",
        `<div ${MODULES_PREVIEW_MARKER} data-openlen-no-edit>${banda}</div>`,
      );
    }
  }

  const wa = cfg.whatsapp;
  if (wa?.enabled && wa.number) {
    const waSide = wa.side === "left" ? "left" : "right";
    const priorRightFabs = (cfg.assistantOn ? 1 : 0) + (cfg.chatFabOn ? 1 : 0);
    const leftOccupied = waSide === "left" && !!cfg.musicOn;
    const baked = bakeWhatsAppButton(out, {
      number: wa.number,
      message: wa.message,
      side: wa.side,
      bottomPx:
        waSide === "right" ? 18 + priorRightFabs * 68 : leftOccupied ? 86 : 18,
    });
    // bakeWhatsAppButton returns the input unchanged when a gate suppressed it
    // (short number, contact-widget dedup) — only stamp an actual injection.
    if (baked !== out) {
      out = baked.replace("data-ol-wa-button", `data-ol-wa-button ${STAMP}`);
    }
  }

  return out;
}
