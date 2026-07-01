// Pure data — types + family metadata. Has NO node imports so it can be
// imported from client components without dragging fs/crypto into the
// browser bundle. The server-only store.ts re-exports these so existing
// `from "@/lib/models/store"` imports continue to work.

export type ModelFamily =
  | "product"
  | "decorative"
  | "prop"
  | "character"
  | "mechanical";

export type ModelStatus = "draft" | "published" | "archived";

export const MODEL_FAMILY_META: Record<
  ModelFamily,
  { label: string; tagline: string }
> = {
  product: {
    label: "Product",
    tagline:
      "Hero product shots — packaged goods, consumer electronics, bottles, boxes. High-gloss studio lighting, clean silhouettes.",
  },
  decorative: {
    label: "Decorative",
    tagline:
      "Abstract shapes, organic forms, and sculptural accents. Used as background depth elements or focal points on landing pages.",
  },
  prop: {
    label: "Prop",
    tagline:
      "Scene props and supporting objects — furniture, plants, vessels. Adds context and scale to hero compositions.",
  },
  character: {
    label: "Character",
    tagline:
      "Stylised figures, mascots, and avatars. Brand characters that convey personality without photorealistic detail.",
  },
  mechanical: {
    label: "Mechanical",
    tagline:
      "Gears, components, hardware, and industrial objects. Technical detail, precise geometry, metallic materials.",
  },
};
