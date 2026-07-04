// Pure data — types + register/format/goal meta. Zero node imports so client
// components (the Marketing tab UI) can import this without dragging fs/crypto
// into the browser bundle. Calco of lib/templates/families.ts.

export type PostRegister =
  | "restaurante"
  | "belleza"
  | "gym"
  | "consultorio"
  | "tienda"
  | "oficios"
  | "general";
export type PostFormat = "square" | "story";
export type PostGoal = "promo" | "anuncio" | "testimonio" | "info";
export type PostTemplateStatus = "draft" | "published" | "archived";

export const POST_REGISTERS: PostRegister[] = [
  "restaurante",
  "belleza",
  "gym",
  "consultorio",
  "tienda",
  "oficios",
  "general",
];

export const POST_GOALS: PostGoal[] = ["promo", "anuncio", "testimonio", "info"];

// Pixel dimensions the render pipeline targets per format — square posts vs.
// vertical stories (IG/FB/WhatsApp status).
export const POST_FORMAT_SIZES: Record<PostFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};
