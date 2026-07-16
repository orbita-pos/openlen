/** Texto legible sobre un fondo de acento (umbral de luminancia). Compartido
 *  por collections-block, bookings-widget y comments-widget (vivía triplicado
 *  byte-idéntico — Minor de la revisión del pase de superficies, 2026-07-15). */
export function inkOn(accent: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(accent.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? "#16181d" : "#ffffff";
}
