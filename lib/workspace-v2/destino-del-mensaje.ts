// A QUIÉN VA UN MENSAJE DEL CHAT (el chat del equipo): sin menciones, a Len,
// como siempre; a una persona sin `@Len`, a ella (Len no contesta); con los
// dos, un turno de Len que además la avisa. Puro: lo prueba vitest.

import { mencionesDe, type PersonaMencionable } from "./menciones";

export type Destino =
  | { readonly tipo: "len" }
  | { readonly tipo: "personas"; readonly personas: readonly PersonaMencionable[] }
  | { readonly tipo: "len-y-personas"; readonly personas: readonly PersonaMencionable[] };

/** `yo` no se cuenta: mencionarse a uno mismo no manda el mensaje a nadie. */
export function destinoDe(texto: string, gente: readonly PersonaMencionable[], yo: string | null): Destino {
  const m = mencionesDe(texto, gente);
  const personas = gente.filter((p) => m.personas.includes(p.userId) && p.userId !== yo);
  if (personas.length === 0) return { tipo: "len" };
  return m.len ? { tipo: "len-y-personas", personas } : { tipo: "personas", personas };
}

/** Un lector escribe a personas, nunca a Len (comentar no es editar). */
export function permitido(destino: Destino, puedeLen: boolean): boolean {
  return puedeLen || destino.tipo === "personas";
}
