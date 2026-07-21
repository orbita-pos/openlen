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
import type { ItemRow } from "@/lib/collections/store";

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
  } | null;
}

export function injectEditorModulesPreview(
  html: string,
  cfg: EditorModulesPreviewCfg,
): string {
  let out = html;

  const col = cfg.collections;
  if (col && col.items.length) {
    const widget = renderCollectionsWidget(out, {
      items: col.items,
      layout: col.layout,
      orders: col.ordersNumber ? { number: col.ordersNumber } : null,
    });
    const bandOpen = /<(section|div)[^>]*\bdata-ol-collection-section\b[^>]*>/i.exec(out);
    if (widget && bandOpen) {
      const stamped = widget.replace(
        "data-ol-collection-widget",
        `data-ol-collection-widget ${STAMP}`,
      );
      const at = bandOpen.index + bandOpen[0].length;
      out = out.slice(0, at) + stamped + out.slice(at);
      // While the real grid previews, hide the band's dashed empty
      // placeholder (a DIRECT child — `>` keeps card internals unaffected).
      out = out.replace(
        "</head>",
        `<style ${MODULES_PREVIEW_MARKER}>[data-ol-collection-section] > div:empty{display:none!important}</style></head>`,
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
