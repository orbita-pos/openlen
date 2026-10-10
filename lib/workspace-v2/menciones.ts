// LAS MENCIONES de un comentario en el código (`@Len`, `@Ana`): a quién va.
// Puro: lo prueba vitest. El servidor vuelve a validar que cada mencionado
// sea del proyecto (`mencionesValidas`, lib/projects/hilos.ts).

export interface PersonaMencionable {
  readonly userId: string;
  readonly nombre: string;
  /** Su foto (lib/profile/avatar.ts → `avatarOf`), si tiene. Sin ella, la inicial. */
  readonly avatar?: string | null;
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

/** Un trozo de un comentario: texto llano, `@Len` o la mención de una persona. */
export interface TrozoDeMencion {
  readonly texto: string;
  readonly len?: true;
  readonly userId?: string;
}

/** El texto en trozos para pintar cada mención con su color. Los mismos límites que `mencionesDe`. */
export function trozosConMenciones(texto: string, personas: readonly PersonaMencionable[]): TrozoDeMencion[] {
  if (!texto) return [];
  const conNombre = personas.filter((p) => p.nombre.trim());
  // El nombre más largo primero: «@Luis Mi» no se queda en «@Luis».
  const nombres = ["Len", ...conNombre.map((p) => p.nombre.trim())].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(^|[^\\w@])@(${nombres.map(escapar).join("|")})(?![\\w])`, "gi");
  const trozos: TrozoDeMencion[] = [];
  let hasta = 0;
  for (const m of texto.matchAll(re)) {
    const desde = m.index + m[1]!.length;
    const nombre = m[2]!.toLowerCase();
    const persona = nombre === "len" ? null : conNombre.find((p) => p.nombre.trim().toLowerCase() === nombre);
    if (desde > hasta) trozos.push({ texto: texto.slice(hasta, desde) });
    const fin = desde + 1 + m[2]!.length;
    trozos.push(persona ? { texto: texto.slice(desde, fin), userId: persona.userId } : { texto: texto.slice(desde, fin), len: true });
    hasta = fin;
  }
  if (hasta < texto.length) trozos.push({ texto: texto.slice(hasta) });
  return trozos;
}

/** Los colores de la gente (tokens.css, claro y oscuro). Ninguno es el naranja de Len (`--accent`). */
export const COLORES_DE_PERSONA = [1, 2, 3, 4, 5, 6].map((n) => `var(--persona-${n})`);

/** El color de una persona: por su puesto en el proyecto (el dueño, y los miembros por antigüedad), así
 *  cada uno tiene el suyo y es el mismo en todas partes. Quien ya no está, uno fijo sacado de su id. */
export function colorDePersona(userId: string, delProyecto: readonly string[]): string {
  const puesto = delProyecto.indexOf(userId);
  if (puesto >= 0) return COLORES_DE_PERSONA[puesto % COLORES_DE_PERSONA.length]!;
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORES_DE_PERSONA[h % COLORES_DE_PERSONA.length]!;
}

/** Pone `@etiqueta ` en lugar de lo que se buscaba; devuelve el texto y el cursor nuevo. */
export function ponerMencion(texto: string, desde: number, cursor: number, etiqueta: string): { readonly texto: string; readonly cursor: number } {
  const puesto = `@${etiqueta} `;
  return { texto: texto.slice(0, desde) + puesto + texto.slice(cursor), cursor: desde + puesto.length };
}
