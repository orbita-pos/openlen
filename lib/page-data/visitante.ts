// El «yo» anónimo de quien visita una página publicada.
//
// 🔴 NO SE REUTILIZA EL ID DE ANALÍTICA. `ANALYTICS_UA_SALT`
// (app/c/[projectId]/route.ts) existe para CONTAR gente sin identificarla;
// convertirlo en llave de acceso a datos es exactamente el mecanismo por el que
// una analítica deja de ser anónima. Cookie propia, con su secreto propio.
//
// ES UN PORTADOR, NO UNA CUENTA. Quien tenga la cookie es el dueño de esos
// documentos. Si el visitante borra cookies, su carrito se fue — y eso hay que
// decirlo en la interfaz, porque prometer que lo recupera en otro móvil sería
// mentir.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const COOKIE_VISITANTE = "ol_v";

const ID_RE = /^[0-9a-f]{32}$/;

function firma(id: string, secreto: string): string {
  return createHmac("sha256", secreto).update(id).digest("base64url").slice(0, 27);
}

/** Un visitante nuevo: id opaco + su firma, listo para meter en la cookie. */
export function nuevoVisitante(secreto: string): string {
  const id = randomBytes(16).toString("hex");
  return `${id}.${firma(id, secreto)}`;
}

/** El id si la cookie es nuestra y no la han tocado; `null` en cualquier otro
 *  caso. NUNCA lanza: esto lee una cabecera que manda cualquiera. */
export function verificaVisitante(
  valor: string | undefined,
  secreto: string,
): string | null {
  if (!valor) return null;
  const punto = valor.indexOf(".");
  if (punto <= 0) return null;

  const id = valor.slice(0, punto);
  const dada = valor.slice(punto + 1);
  if (!ID_RE.test(id)) return null;

  const buena = firma(id, secreto);
  // Comparación en tiempo constante: una comparación normal filtra la firma
  // byte a byte a quien mida. Las longitudes se igualan antes porque
  // `timingSafeEqual` LANZA si difieren — y aquí no puede lanzar nada.
  const a = Buffer.from(dada);
  const b = Buffer.from(buena);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? id : null;
}
