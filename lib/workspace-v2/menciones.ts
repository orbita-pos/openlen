// LAS MENCIONES de un comentario en el código (`@Len`, `@Ana`): a quién va.
// Puro: lo prueba vitest. El servidor vuelve a validar que cada mencionado
// sea del proyecto (`mencionesValidas`, lib/projects/hilos.ts).

export interface PersonaMencionable {
  readonly userId: string;
  readonly nombre: string;
}

export interface Menciones {
  readonly len: boolean;
  readonly personas: readonly string[];
}

const LEN = /(^|[^\w@])@len\b/i;

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ¿A quién menciona `texto`? `@Nombre` exacto (sin distinguir mayúsculas), y `@Len`. */
export function mencionesDe(texto: string, personas: readonly PersonaMencionable[]): Menciones {
  const encontradas = personas.filter((p) => {
    const nombre = p.nombre.trim();
    if (!nombre) return false;
    return new RegExp(`(^|[^\\w@])@${escapar(nombre)}(?![\\w])`, "i").test(texto);
  });
  return { len: LEN.test(texto), personas: [...new Set(encontradas.map((p) => p.userId))] };
}

export const hayMencion = (m: Menciones) => m.len || m.personas.length > 0;

/** La palabra con `@` que se está escribiendo justo antes del cursor, si la hay. */
export function arrobaEnCurso(texto: string, cursor: number): { readonly desde: number; readonly busca: string } | null {
  const antes = texto.slice(0, cursor);
  const m = /(^|\s)@([^\s@]{0,40})$/.exec(antes);
  if (!m) return null;
  return { desde: cursor - m[2]!.length - 1, busca: m[2]! };
}

/** Las opciones del desplegable para lo que se busca: Len primero, luego la gente. */
export function opcionesDeMencion(
  busca: string,
  personas: readonly PersonaMencionable[],
  conLen: boolean,
): { readonly etiqueta: string; readonly userId: string | null }[] {
  const b = busca.toLowerCase();
  const todas = [
    ...(conLen ? [{ etiqueta: "Len", userId: null }] : []),
    ...personas.map((p) => ({ etiqueta: p.nombre, userId: p.userId as string | null })),
  ];
  // Primero las que EMPIEZAN por lo buscado; luego las que lo tienen en otra palabra.
  const empiezan = todas.filter((o) => o.etiqueta.toLowerCase().startsWith(b));
  const enOtra = todas.filter((o) => !empiezan.includes(o) && o.etiqueta.toLowerCase().includes(` ${b}`));
  return [...empiezan, ...enOtra].slice(0, 8);
}

/** Pone `@etiqueta ` en lugar de lo que se buscaba; devuelve el texto y el cursor nuevo. */
export function ponerMencion(texto: string, desde: number, cursor: number, etiqueta: string): { readonly texto: string; readonly cursor: number } {
  const puesto = `@${etiqueta} `;
  return { texto: texto.slice(0, desde) + puesto + texto.slice(cursor), cursor: desde + puesto.length };
}
