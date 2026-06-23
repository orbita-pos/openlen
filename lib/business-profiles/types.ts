import type { InferSelectModel } from "drizzle-orm";
import type { businessProfiles } from "@/lib/db/schema";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";

// Brand identity stored alongside the business copy. Applied to a page in
// Fase 2 (logo → nav, accent → theme) via the Replace-asset machinery.
export interface BusinessProfileBrand {
  logoUrl: string | null;
  accent: string | null; // hex, e.g. "#e8743a"
}

// Extra links the user wants on their pages (site/store, Linktree, YouTube,
// TikTok, etc.). `type` is a loose key (website|menu|youtube|tiktok|other|…).
export interface BusinessProfileLink {
  type: string;
  url: string;
}

// What a saved profile stores: the same shape the fill engine consumes
// (ExtractedBusinessData, incl. the new contact block) plus brand + photos +
// extra links.
export type BusinessProfileData = ExtractedBusinessData & {
  brand?: BusinessProfileBrand | null;
  photos?: string[]; // image URLs
  links?: BusinessProfileLink[];
  // Show the floating contact bar (WhatsApp/socials/contact) on seeded pages.
  // Defaults ON — only an explicit `false` hides it. Opt-out, not opt-in, so
  // existing profiles keep current behaviour.
  showContactWidget?: boolean;
  // Which corner the floating contact bar sits in. Defaults to "right".
  contactWidgetSide?: "left" | "right";
};

// The DB row type (id, userId, name, data, isDefault, timestamps).
export type BusinessProfile = InferSelectModel<typeof businessProfiles>;
