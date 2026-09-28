/**
 * LO QUE VUELVE TRAS EDITAR: diagnósticos anclados a una línea de un fichero,
 * como los `<new-diagnostics>` de Claude Code (plans/len-2/ficheros-plan.md, T9).
 *
 * Como los da Claude Code:
 *   · el sobre: «<new-diagnostics>The following new diagnostic
 *     issues were detected:\n\n», cada fichero con `<fichero>:` y una línea por
 *     diagnóstico `  <símbolo> [Line L:C] <mensaje> [<código>] (<fuente>)`,
 *     ficheros separados por una línea en blanco, y corte a 4.000 caracteres con
 *     «…[truncated]»;
 *   · los símbolos, del juego unicode de `figures`: Error ✘, Warning ⚠,
 *     Info ℹ, Hint ★;
 *   · los topes y el orden: por gravedad, 10 por fichero y 30 en total;
 *   · la identidad de un diagnóstico: mensaje, gravedad, rango, fuente y
 *     código.
 *
 * Lo que Claude Code no cubre o se decide distinto, dicho en voz alta (§B del
 * plan):
 *   · la ruta va ENTERA y no sólo el nombre del fichero, porque
 *     aquí todas las páginas se llaman `index.html` y el nombre base no diría
 *     cuál (B4);
 *   · la identidad NO lleva el rango. En Claude Code sí: un servidor de lenguaje
 *     no tiene otra forma de distinguir dos diagnósticos iguales, y si una
 *     edición corre las líneas, lo de debajo vuelve a salir «nuevo». Aquí cada
 *     mensaje ya nombra lo concreto (el selector, el href, el id, el texto
 *     ilegible), así que el rango sólo añadiría falsos «nuevos» tras cada Edit
 *     que mete una línea — justo lo que la línea base existe para no decir.
 *
 * Puro: sin navegador, sin base, sin binding.
 */

export type Gravedad = "Error" | "Warning" | "Info" | "Hint";

export interface Diagnostico {
  /** El fichero, con su ruta del sitio: `/index.html`, `/menu/index.html`. */
  readonly ruta: string;
  /** Línea y columna desde 1, las del `cat -n` de Read. */
  readonly linea: number;
  readonly columna: number;
  readonly gravedad: Gravedad;
  readonly mensaje: string;
  readonly codigo?: string;
  readonly fuente?: string;
}

const SIMBOLO: Record<Gravedad, string> = { Error: "✘", Warning: "⚠", Info: "ℹ", Hint: "★" };
const ORDEN: Record<Gravedad, number> = { Error: 1, Warning: 2, Info: 3, Hint: 4 };
const MAX_POR_FICHERO = 10;
const MAX_TOTAL = 30;
const MAX_CARACTERES = 4000;
const CORTE = "…[truncated]";

export function claveDeDiagnostico(d: Diagnostico): string {
  return JSON.stringify([d.ruta, d.mensaje, d.gravedad, d.fuente ?? null, d.codigo ?? null]);
}

/** Por fichero en el orden en que aparecen, cada uno ordenado por gravedad
 *  (orden estable, como `Array.prototype.sort`) y con los topes de Claude Code. */
function agrupar(ds: readonly Diagnostico[]): { ruta: string; lista: Diagnostico[] }[] {
  const porRuta = new Map<string, Diagnostico[]>();
  for (const d of ds) {
    const lista = porRuta.get(d.ruta) ?? [];
    lista.push(d);
    porRuta.set(d.ruta, lista);
  }
  let total = 0;
  const fuera: { ruta: string; lista: Diagnostico[] }[] = [];
  for (const [ruta, lista] of porRuta) {
    const ordenada = [...lista].sort((a, b) => ORDEN[a.gravedad] - ORDEN[b.gravedad]).slice(0, MAX_POR_FICHERO);
    const caben = ordenada.slice(0, Math.max(0, MAX_TOTAL - total));
    total += caben.length;
    if (caben.length > 0) fuera.push({ ruta, lista: caben });
  }
  return fuera;
}

export function redactarDiagnosticos(ds: readonly Diagnostico[]): string | null {
  const grupos = agrupar(ds);
  if (grupos.length === 0) return null;
  let cuerpo = grupos
    .map(
      ({ ruta, lista }) =>
        `${ruta}:\n` +
        lista
          .map(
            (d) =>
              `  ${SIMBOLO[d.gravedad]} [Line ${d.linea}:${d.columna}] ${d.mensaje}` +
              `${d.codigo ? ` [${d.codigo}]` : ""}${d.fuente ? ` (${d.fuente})` : ""}`,
          )
          .join("\n"),
    )
    .join("\n\n");
  if (cuerpo.length > MAX_CARACTERES) cuerpo = cuerpo.slice(0, MAX_CARACTERES - CORTE.length) + CORTE;
  return `<new-diagnostics>Problems that appeared with this change:\n\n${cuerpo}</new-diagnostics>`;
}

/**
 * LO NUEVO, y una sola vez: resta la línea base del fichero (lo que ya tenía
 * antes de que Len lo tocara, como la línea base de Claude Code) y lo que ya se le
 * entregó en este turno (el `delivered` del registro).
 */
export class NuevosDiagnosticos {
  #entregados = new Set<string>();

  nuevos(ahora: readonly Diagnostico[], base: readonly Diagnostico[] = []): Diagnostico[] {
    const antes = new Set(base.map(claveDeDiagnostico));
    const fuera: Diagnostico[] = [];
    for (const d of ahora) {
      const k = claveDeDiagnostico(d);
      if (antes.has(k) || this.#entregados.has(k)) continue;
      this.#entregados.add(k);
      fuera.push(d);
    }
    return fuera;
  }
}

/** Línea y columna (desde 1) del carácter `indice` del fichero. */
export function posicionEnIndice(html: string, indice: number): { linea: number; columna: number } {
  let linea = 1;
  let inicio = 0;
  for (let i = 0; i < indice && i < html.length; i++) {
    if (html.charCodeAt(i) === 10) {
      linea++;
      inicio = i + 1;
    }
  }
  return { linea, columna: indice - inicio + 1 };
}

/** Dónde aparece `aguja` por primera vez; `null` si no está. */
export function posicionDe(html: string, aguja: string, desde = 0): { linea: number; columna: number } | null {
  if (!aguja) return null;
  const i = html.indexOf(aguja, desde);
  return i === -1 ? null : posicionEnIndice(html, i);
}
