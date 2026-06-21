// The AI→módulos bridge. When a generated or chat-edited page contains a
// module's placeholder section, that's the creator's intent expressed in
// natural language ("quiero reservas" / "un catálogo de productos") — so we
// turn the module ON, and the publish bake wires the real widget into that
// marker. The AI is taught to emit these placeholders on clear intent (see
// lib/design-guidance.ts); this is the server-side half that flips the flag.
//
// Only the BORN-STATIC, no-auth modules are bridged:
//   • Bookings    — data-ol-bookings-section   (lib/publish/bookings-widget.ts)
//   • Collections — data-ol-collection-section (lib/publish/collections-block.ts)
// Comments + Members need a login (ambiguous to auto-enable from a brief) and
// Broadcast has no page widget, so they are intentionally NOT bridged.

import type { ProjectSettings } from "@/lib/projects/types";
import { reconcileModuleSettings } from "@/lib/projects/module-settings";

export type BridgedModule = "bookings" | "collections";

const MARKERS: Record<BridgedModule, string> = {
  bookings: "data-ol-bookings-section",
  collections: "data-ol-collection-section",
};

/** Which bridged modules the page's HTML asks for (placeholder present). */
export function detectModuleIntent(html: string): Record<BridgedModule, boolean> {
  return {
    bookings: html.includes(MARKERS.bookings),
    collections: html.includes(MARKERS.collections),
  };
}

/** Enable any bridged module whose placeholder appears in `html`, merged onto
 *  the existing settings and reconciled. Returns the SAME settings reference and
 *  an empty `enabled` list when nothing changed, so callers can skip the write. */
export function applyModuleIntent(
  settings: ProjectSettings | undefined,
  html: string,
): { settings: ProjectSettings; enabled: BridgedModule[] } {
  const intent = detectModuleIntent(html);
  const base: ProjectSettings = settings ?? {};
  let next: ProjectSettings = base;
  const enabled: BridgedModule[] = [];

  if (intent.bookings && base.bookings?.enabled !== true) {
    next = { ...next, bookings: { ...next.bookings, enabled: true } };
    enabled.push("bookings");
  }
  if (intent.collections && base.collections?.enabled !== true) {
    next = { ...next, collections: { ...next.collections, enabled: true } };
    enabled.push("collections");
  }

  if (enabled.length === 0) return { settings: base, enabled };
  return { settings: reconcileModuleSettings(next), enabled };
}
