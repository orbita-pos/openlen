// lib/projects/module-placements.ts
// Where each content module's band lives across the site — powers the hub's
// "En: inicio, /catalogo" state line and the Library's singleton-per-page
// rule. String-level marker checks. ⚠️ Los marcadores que busca ya no los emite
// NADIE: `module-sections.ts` se retiró el 2026-09-05 con el limpiador de
// bandas, y `PlacedModule` sólo nombra módulos retirados. Sólo puede encontrar
// bandas HEREDADAS de páginas viejas.
import type { ProjectData } from "./types";

export type PlacedModule = "collections" | "bookings" | "platforms";

export const PLACED_MODULE_MARKERS: Record<PlacedModule, string> = {
  collections: "data-ol-collection-section",
  bookings: "data-ol-bookings-section",
  platforms: "data-ol-platforms-section",
};

/** Docs carrying each module's band; "" = home, first, then slugs sorted. */
export function modulePlacements(
  data: Pick<ProjectData, "html" | "pages"> | null | undefined,
): Record<PlacedModule, string[]> {
  const out: Record<PlacedModule, string[]> = {
    collections: [],
    bookings: [],
    platforms: [],
  };
  if (!data) return out;
  const docs: Array<[string, string]> = [["", data.html ?? ""]];
  for (const slug of Object.keys(data.pages ?? {}).sort()) {
    docs.push([slug, data.pages?.[slug]?.html ?? ""]);
  }
  for (const mod of Object.keys(out) as PlacedModule[]) {
    for (const [slug, html] of docs) {
      if (html.includes(PLACED_MODULE_MARKERS[mod])) out[mod].push(slug);
    }
  }
  return out;
}

/** Does ONE document already carry the module's band? (Library singleton.) */
export function pageHasModule(
  html: string | null | undefined,
  mod: PlacedModule,
): boolean {
  return !!html && html.includes(PLACED_MODULE_MARKERS[mod]);
}
