// Curated typography presets — named display-font options the inspector
// applies in one click. v1 swaps only the display font (`--ol-font-display`),
// since the engine currently exposes one font token. When a body-font token
// ships (Phase 2/3), each entry will grow `bodyCss` and the catalog will
// expand to true pair territory. Each entry references a family preloaded
// by normalizeFont's DISPLAY_FONTS_LINK.

export interface FontPreset {
  id: string;
  name: string;
  hint: string;
  /** Display-font CSS value (the `font-family` form). */
  displayCss: string;
  /** Display-font family name — used to mark the picker's active option. */
  displayName: string;
  /** Letter shown in the preview cell — picked to flatter the family. */
  previewChar: string;
}

export const FONT_PRESETS: FontPreset[] = [
  // Sans — moderno
  { id: "moderno", name: "Moderno", hint: "Inter limpio, tech default", displayCss: "'Inter', sans-serif", displayName: "Inter", previewChar: "Aa" },
  { id: "geometrico", name: "Geométrico", hint: "Geist nítido", displayCss: "'Geist', sans-serif", displayName: "Geist", previewChar: "Aa" },
  { id: "minimal", name: "Minimal", hint: "Manrope balanceado", displayCss: "'Manrope', sans-serif", displayName: "Manrope", previewChar: "Aa" },
  { id: "amigable", name: "Amigable", hint: "Plus Jakarta, accesible", displayCss: "'Plus Jakarta Sans', sans-serif", displayName: "Plus Jakarta Sans", previewChar: "Aa" },
  { id: "ligero", name: "Ligero", hint: "Outfit aireado", displayCss: "'Outfit', sans-serif", displayName: "Outfit", previewChar: "Aa" },
  { id: "tecnico", name: "Técnico", hint: "Space Grotesk con personalidad", displayCss: "'Space Grotesk', sans-serif", displayName: "Space Grotesk", previewChar: "Aa" },
  // Serif — editorial
  { id: "editorial", name: "Editorial", hint: "Fraunces para revista", displayCss: "'Fraunces', serif", displayName: "Fraunces", previewChar: "Aa" },
  { id: "academico", name: "Académico", hint: "Source Serif 4 sobrio", displayCss: "'Source Serif 4', serif", displayName: "Source Serif 4", previewChar: "Aa" },
  { id: "caligrafico", name: "Caligráfico", hint: "Crimson Pro literario", displayCss: "'Crimson Pro', serif", displayName: "Crimson Pro", previewChar: "Aa" },
  { id: "magazine", name: "Magazine", hint: "Playfair Display elegante", displayCss: "'Playfair Display', serif", displayName: "Playfair Display", previewChar: "Aa" },
  { id: "premium", name: "Premium", hint: "DM Serif Display imponente", displayCss: "'DM Serif Display', serif", displayName: "DM Serif Display", previewChar: "Aa" },
  { id: "delicado", name: "Delicado", hint: "Instrument Serif fino", displayCss: "'Instrument Serif', serif", displayName: "Instrument Serif", previewChar: "Aa" },
];
