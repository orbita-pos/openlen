import { coerceBusinessData } from "@/lib/style-match/autofill/types";
import type { BusinessProfileData } from "./types";

// Coerce arbitrary client input into a valid BusinessProfileData: the business
// copy goes through the lenient coercer (fills nulls/[]/contact), brand + photos
// are validated shallowly. Shared by the create + update routes.
export function normalizeProfileData(raw: unknown): BusinessProfileData {
  const base = coerceBusinessData(raw);
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const brandRaw =
    obj.brand && typeof obj.brand === "object"
      ? (obj.brand as Record<string, unknown>)
      : null;
  const brand = brandRaw
    ? {
        logoUrl: typeof brandRaw.logoUrl === "string" ? brandRaw.logoUrl : null,
        accent: typeof brandRaw.accent === "string" ? brandRaw.accent : null,
      }
    : null;
  const photos = Array.isArray(obj.photos)
    ? obj.photos.filter((p): p is string => typeof p === "string")
    : [];
  const links = Array.isArray(obj.links)
    ? obj.links
        .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
        .map((l) => ({
          type: typeof l.type === "string" ? l.type : "other",
          url: typeof l.url === "string" ? l.url.trim() : "",
        }))
        .filter((l) => l.url.length > 0)
    : [];
  const out: BusinessProfileData = { ...base, brand, photos, links };
  // Display preferences for the floating contact bar: only persist explicit
  // values (absent → undefined → the widget's own defaults: shown, right side).
  if (typeof obj.showContactWidget === "boolean") {
    out.showContactWidget = obj.showContactWidget;
  }
  if (obj.contactWidgetSide === "left" || obj.contactWidgetSide === "right") {
    out.contactWidgetSide = obj.contactWidgetSide;
  }
  // EL DOCUMENTO DEL NEGOCIO. Sin esta línea el Agente escribe lo que aprende y
  // el siguiente «Guardar» de «Mi negocio» lo borra —esta función RECONSTRUYE el
  // perfil desde una lista blanca, no lo parchea— y nadie se entera, porque
  // guardar un formulario no avisa de lo que se llevó por delante.
  if (typeof obj.memoria === "string") {
    const m = obj.memoria.trim();
    out.memoria = m.length > 0 ? m : null;
  } else if (obj.memoria === null) {
    out.memoria = null;
  }
  return out;
}
