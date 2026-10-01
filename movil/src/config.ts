// Dónde está OpenLen. En dev, el servidor `len-voz` (3007), que el teléfono ve
// como localhost por `adb reverse`.
export const BASE = import.meta.env.VITE_OPENLEN_BASE ?? "http://localhost:3007";
export const IDIOMAS = ["es", "en", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"] as const;
export type Idioma = (typeof IDIOMAS)[number];
export function idiomaDelTelefono(): Idioma {
  const l = (navigator.language || "es").slice(0, 2) as Idioma;
  return IDIOMAS.includes(l) ? l : "es";
}
