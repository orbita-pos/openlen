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
  return { ...base, brand, photos, links };
}
