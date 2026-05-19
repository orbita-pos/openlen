// Pure data — types + family metadata. Has NO node imports so it can be
// imported from client components without dragging fs/crypto into the
// browser bundle. The server-only store.ts re-exports these so existing
// `from "@/lib/templates/store"` imports continue to work.

export type TemplateFamily = "technical-minimal" | "editorial" | "commerce";
export type TemplateMode = "dark" | "light" | "cream";
export type TemplateStatus = "draft" | "published" | "archived";

export const TEMPLATE_FAMILY_META: Record<
  TemplateFamily,
  { label: string; tagline: string }
> = {
  "technical-minimal": {
    label: "Technical Minimal",
    tagline:
      "Dark, mono accents, terminal mockups. For devtools and infra.",
  },
  editorial: {
    label: "Editorial",
    tagline:
      "Serif headlines, numbered sections, magazine rhythm. For premium and craft brands.",
  },
  commerce: {
    label: "Commerce",
    tagline:
      "Modern retail tech, payment flows, product mockups. For POS and marketplace.",
  },
};
