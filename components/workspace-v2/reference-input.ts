import type { StyleDirection } from "@/lib/style-match/direction-types";

// La parte del campo de referencia que no necesita un DOM para probarse:
// cómo se lee lo que el usuario teclea y qué se le dice cuando algo falla.

/**
 * Lo que la gente pega no es una URL: es "stripe.com", con espacios delante, a
 * veces sin esquema. Exigirles `https://` sería fricción de configuración por
 * un carácter que el navegador lleva veinte años poniendo solo.
 *
 * Devuelve `null` si ni siquiera con esa ayuda hay algo que traer. El servidor
 * vuelve a validar de todos modos —ahí está la defensa SSRF de verdad—; esto
 * sólo evita el viaje de ida y vuelta para un error evidente.
 */
export function normalizeReferenceUrl(raw: string): string | null {
  const limpio = raw.trim();
  if (limpio === "") return null;

  const conEsquema = /^https?:\/\//i.test(limpio) ? limpio : `https://${limpio}`;
  let url: URL;
  try {
    url = new URL(conEsquema);
  } catch {
    return null;
  }
  // Un host sin punto ("localhost", "intranet") no es una web pública. El
  // servidor lo rechazaría igual, pero decirlo aquí es más rápido y no revela
  // NADA de la red interna — que es justo por lo que el servidor no detalla.
  if (!url.hostname.includes(".")) return null;
  if (url.hostname.endsWith(".")) return null;
  return url.toString();
}

/** Los códigos que devuelve `/api/style-reference`, más los del transporte. */
export type ReferenceErrorCode =
  | "blocked"
  | "unreachable"
  | "not_rendered"
  | "rate_limited"
  | "network";

export function referenceErrorCode(status: number, body: unknown): ReferenceErrorCode {
  if (status === 429) return "rate_limited";
  const code = (body as { error?: unknown } | null)?.error;
  if (code === "blocked" || code === "unreachable" || code === "not_rendered") return code;
  return "network";
}

/** Cuántos colores enseña la pastilla. Cinco caben; más se vuelven confeti. */
export const SWATCH_LIMIT = 5;

export function swatches(d: StyleDirection): readonly string[] {
  return d.palette.slice(0, SWATCH_LIMIT).map((p) => p.hex);
}
