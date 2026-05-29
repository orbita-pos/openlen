// Workspace SectionsPanel data layer. Mirrors templates-data.ts but the
// gallery axis is section TYPE (hero/pricing/…), not design family — a
// section's look is re-themed to the host on insert. Type meta is canonical
// in lib/sections/types (client-safe, zero node imports).

import {
  SECTION_TYPE_META,
  SECTION_TYPES,
  type SectionMode,
  type SectionType,
} from "@/lib/sections/types";

export { SECTION_TYPE_META, SECTION_TYPES };
export type { SectionType, SectionMode };

// Shape the SectionsPanel cards consume. Derived from the API list item plus
// a derived `previewUrl` pointing at the wrapped preview doc.
export interface SectionSpec {
  id: string;
  type: SectionType;
  name: string;
  variantLabel: string;
  mode: SectionMode;
  rootTag: string;
  /** Content rendered by inline JS — surfaced as a card hint. */
  needsJs: boolean;
  /** Ships gradient placeholders to swap for real assets after insert. */
  hasPlaceholders: boolean;
  /** Wrapped preview doc URL — passed to <iframe src>. */
  previewUrl: string;
}

interface ApiListItem {
  id: string;
  type: SectionType;
  name: string;
  variantLabel: string;
  mode: SectionMode;
  rootTag: string;
  needsJs: boolean;
  hasPlaceholders: boolean;
}

export function apiItemToSpec(s: ApiListItem): SectionSpec {
  return {
    id: s.id,
    type: s.type,
    name: s.name,
    variantLabel: s.variantLabel,
    mode: s.mode,
    rootTag: s.rootTag,
    needsJs: s.needsJs,
    hasPlaceholders: s.hasPlaceholders,
    previewUrl: `/api/sections/${s.id}/preview`,
  };
}

// Types ordered for the gallery (roughly top-of-page → bottom-of-page).
export const SECTION_TYPES_ORDERED: SectionType[] = [...SECTION_TYPES].sort(
  (a, b) => SECTION_TYPE_META[a].order - SECTION_TYPE_META[b].order,
);
