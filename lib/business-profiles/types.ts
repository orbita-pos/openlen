import type { InferSelectModel } from "drizzle-orm";
import type { businessProfiles } from "@/lib/db/schema";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";

// Brand identity stored alongside the business copy. Applied to a page in
// Fase 2 (logo → nav, accent → theme) via the Replace-asset machinery.
export interface BusinessProfileBrand {
  logoUrl: string | null;
  accent: string | null; // hex, e.g. "#e8743a"
}

// What a saved profile stores: the same shape the fill engine consumes
// (ExtractedBusinessData, incl. the new contact block) plus brand + photos.
export type BusinessProfileData = ExtractedBusinessData & {
  brand?: BusinessProfileBrand | null;
  photos?: string[]; // image URLs
};

// The DB row type (id, userId, name, data, isDefault, timestamps).
export type BusinessProfile = InferSelectModel<typeof businessProfiles>;
