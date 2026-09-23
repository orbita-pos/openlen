// lib/agent/cambios-del-dueno.ts — lo que el dueño cambió a mano desde el
// último turno de Len, dicho al modelo al empezar el siguiente.
//
// 🔴 EL FALLO QUE CIERRA (H07 de `plans/auditoria-len-vs-claude-code-2026-09-22.md`).
// Cada turno recarga el documento fresco, pero nada le decía al modelo QUÉ
// cambió desde su último turno ni QUIÉN. El registro de cambios son etiquetas
// sin contenido, y una edición de contenido hecha dentro de los cinco minutos
// del editor no deja ni etiqueta. Su historial decía «puse el titular X», la
// página decía Y, y a «¿qué cambió?» contestaba atribuyéndose lo que había
// hecho el dueño (medido el 2026-09-22, C13).
//
// LA VARA ES CLAUDE CODE: al empezar cada petición le avisa al modelo de cada
// fichero que había leído y que cambió en disco, con el fragmento cambiado. Aquí
// «lo que había leído» es lo que Len dejó escrito —su última versión en esa
// página— y el fragmento es el texto visible que cambió.
//
// Puro: el llamador trae las versiones, el documento de ahora y cómo leer el
// HTML de una versión.

import { bloquesDelCambio, trocear, ultimaEscrituraDeLen } from "@/lib/agent/deshacer-lo-de-len";

/** Cuántos cambios se enseñan, y cuánto texto de cada uno. Es contexto que se
 *  paga en cada turno; lo que pasa de aquí se cuenta, no se copia. */
const MAX_CAMBIOS = 6;
const MAX_TEXTO = 120;

function textoVisible(lineas: readonly string[]): string {
  const t = lineas
    .join(" ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > MAX_TEXTO ? `${t.slice(0, MAX_TEXTO)}…` : t;
}

/**
 * Los cambios entre lo que dejó Len (`delLen`) y lo que hay ahora (`actual`),
 * una línea por cambio de texto visible, más una que cuenta los de marcado.
 * Vacío si no cambió nada.
 */
export function describirCambiosDelDueno(delLen: string, actual: string): string[] {
  const antes = trocear(delLen);
  const ahora = trocear(actual);
  const lineas: string[] = [];
  let deMarcado = 0;
  for (const b of bloquesDelCambio(antes, ahora)) {
    const quitado = textoVisible(antes.slice(b.aDesde, b.aHasta));
    const puesto = textoVisible(ahora.slice(b.lDesde, b.lHasta));
    if (quitado === puesto) deMarcado += 1;
    else if (quitado && puesto) lineas.push(`«${quitado}» → «${puesto}»`);
    else if (puesto) lineas.push(`añadió «${puesto}»`);
    else lineas.push(`quitó «${quitado}»`);
  }
  const mostradas = lineas.slice(0, MAX_CAMBIOS);
  const resto = lineas.length - mostradas.length + (deMarcado > 0 ? deMarcado : 0);
  if (resto > 0) {
    mostradas.push(
      deMarcado > 0 && lineas.length <= MAX_CAMBIOS
        ? `y ${deMarcado} cambio(s) de marcado o estilo sin texto visible`
        : `y ${resto} cambio(s) más`,
    );
  }
  return mostradas;
}

/**
 * Lo que el dueño cambió en ESTA página desde la última escritura de Len en
 * ella. `[]` si Len nunca escribió aquí, si no se pudo leer su versión, o si la
 * página sigue exactamente como la dejó.
 *
 * Fail-soft: esto es contexto, y no poder calcularlo no puede costarle el
 * turno a nadie.
 */
export async function loQueCambioElDueno(o: {
  /** Del más nuevo al más viejo, de TODAS las páginas: se filtra aquí. */
  readonly versiones: readonly { readonly id: string; readonly source?: string; readonly page?: string | null }[];
  readonly page: string | null;
  /** El documento de ahora, sin `data-op-id`. */
  readonly actual: string;
  /** El HTML de una versión, ya sin `data-op-id`; `null` si no se pudo leer. */
  readonly leerHtml: (versionId: string) => Promise<string | null>;
}): Promise<string[]> {
  try {
    const deLaPagina = o.versiones.filter((v) => (v.page ?? null) === o.page);
    const i = ultimaEscrituraDeLen(deLaPagina);
    if (i < 0) return [];
    const delLen = await o.leerHtml(deLaPagina[i]!.id);
    if (delLen === null || delLen === o.actual) return [];
    return describirCambiosDelDueno(delLen, o.actual);
  } catch {
    return [];
  }
}
