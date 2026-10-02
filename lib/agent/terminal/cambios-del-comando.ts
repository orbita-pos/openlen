/**
 * LO QUE CAMBIÓ UN COMANDO, POR FICHERO, EN LA PROPIA LLAMADA (la #10 de
 * plans/len-agente-2026/notas/fase-5-taller.md).
 *
 * Como Claude Code: tras un `bash` que
 * tocó ficheros, cada uno con «Creado / Actualizado / Borrado», su ruta y
 * `(+N −M)`, y sus trozos hasta 40 líneas por fichero («… N líneas más»). Como
 * mucho 5 ficheros; uno con un diff de 400 líneas o más no se enseña, y él y los
 * que no caben cuentan en «… N archivos más». Allí sale de dos fotos de git, y
 * por eso avisa de que es «una vista de comodidad»: otro proceso pudo tocar el
 * repositorio a la vez. Aquí sale de la foto de la terminal antes del comando y
 * de lo que de verdad QUEDÓ después (un fichero que las guardas rechazaron no
 * sale): es exacto, y no lleva ese aviso.
 *
 * ES SÓLO PARA LA PANTALLA. Viaja en el evento `terminal` y en la respuesta
 * guardada bajo su propia clave, fuera de `tool_result`: al modelo sólo le llega
 * ese texto (`fireworks-bridge.ts`), y si una transcripción no cabe en su tope,
 * esto se quita antes que nada de lo que el modelo lee (`transcripcion.ts`).
 *
 * Puro: lo prueba vitest, y el navegador lee con `leerCambiosDelComando`.
 */
import { diffDeFichero, type LineaDelDiff, type TrozoDelDiff } from "@/lib/workspace-v2/diff-de-ficheros";
import { cambiosDeLaTerminal } from "./ficheros";

/** La clave en la respuesta guardada del `bash`. */
export const CLAVE_CAMBIOS_DEL_COMANDO = "cambios_del_comando";

/** Los topes, como los de Claude Code. */
export const MAX_FICHEROS = 5;
export const LINEAS_POR_FICHERO = 40;
export const DIFF_DEMASIADO_GRANDE = 400;
/** El nuestro: una línea de HTML puede medir decenas de KB, y esto se guarda en la fila. */
export const CARACTERES_POR_LINEA = 200;

export type TipoDeCambio = "creado" | "actualizado" | "borrado";

export interface FicheroDelComando {
  readonly ruta: string;
  readonly tipo: TipoDeCambio;
  readonly anadidas: number;
  readonly quitadas: number;
  readonly trozos: readonly TrozoDelDiff[];
  /** Líneas del diff que no caben en las 40. */
  readonly ocultas: number;
}

export interface CambiosDelComando {
  readonly ficheros: readonly FicheroDelComando[];
  /** Los que no se enseñan: pasan de cinco o su diff es demasiado grande. */
  readonly masFicheros: number;
}

function recortarLinea(l: LineaDelDiff): LineaDelDiff {
  return l.texto.length > CARACTERES_POR_LINEA ? { ...l, texto: `${l.texto.slice(0, CARACTERES_POR_LINEA)}…` } : l;
}

/** Los trozos hasta `tope` líneas en total, como la `J` de Claude Code. */
function recortar(trozos: readonly TrozoDelDiff[], tope: number): { trozos: TrozoDelDiff[]; ocultas: number } {
  const salida: TrozoDelDiff[] = [];
  let usadas = 0;
  let ocultas = 0;
  for (const t of trozos) {
    const caben = tope - usadas;
    if (caben <= 0) ocultas += t.lineas.length;
    else {
      const lineas = t.lineas.slice(0, caben).map(recortarLinea);
      salida.push({ saltadas: t.saltadas, lineas });
      usadas += lineas.length;
      ocultas += t.lineas.length - lineas.length;
    }
  }
  return { trozos: salida, ocultas };
}

/** Null si el comando no cambió ningún fichero del proyecto. */
export function cambiosDelComando(
  antes: Readonly<Record<string, string>>,
  despues: Readonly<Record<string, string>>,
): CambiosDelComando | null {
  const lista = cambiosDeLaTerminal(antes, despues);
  if (lista.length === 0) return null;
  const ficheros: FicheroDelComando[] = [];
  let masFicheros = 0;
  for (const c of lista) {
    if (ficheros.length >= MAX_FICHEROS) {
      masFicheros++;
      continue;
    }
    const d = diffDeFichero(Object.hasOwn(antes, c.ruta) ? antes[c.ruta]! : null, c.tipo === "borrado" ? null : c.contenido);
    if (d.trozos.reduce((n, t) => n + t.lineas.length, 0) >= DIFF_DEMASIADO_GRANDE) {
      masFicheros++;
      continue;
    }
    const { trozos, ocultas } = recortar(d.trozos, LINEAS_POR_FICHERO);
    ficheros.push({
      ruta: c.ruta,
      tipo: c.tipo === "borrado" ? "borrado" : c.crea ? "creado" : "actualizado",
      anadidas: d.anadidas,
      quitadas: d.quitadas,
      trozos,
      ocultas,
    });
  }
  return { ficheros, masFicheros };
}

const TIPOS = new Set<string>(["creado", "actualizado", "borrado"]);
const TIPOS_DE_LINEA = new Set<string>(["igual", "quitada", "anadida"]);
const entero = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;
const numeroDeLinea = (x: unknown): x is number | null => x === null || (entero(x) && x > 0);

function linea(x: unknown): LineaDelDiff | null {
  const l = x as Partial<LineaDelDiff> | null;
  if (!l || typeof l.texto !== "string" || !TIPOS_DE_LINEA.has(l.tipo as string)) return null;
  if (!numeroDeLinea(l.antes) || !numeroDeLinea(l.despues)) return null;
  return { tipo: l.tipo!, texto: l.texto, antes: l.antes, despues: l.despues };
}

function fichero(x: unknown): FicheroDelComando | null {
  const f = x as Partial<FicheroDelComando> | null;
  if (!f || typeof f.ruta !== "string" || !TIPOS.has(f.tipo as string)) return null;
  if (!entero(f.anadidas) || !entero(f.quitadas) || !entero(f.ocultas) || !Array.isArray(f.trozos)) return null;
  const trozos: TrozoDelDiff[] = [];
  for (const t of f.trozos as unknown[]) {
    const tr = t as Partial<TrozoDelDiff> | null;
    if (!tr || !entero(tr.saltadas) || !Array.isArray(tr.lineas)) return null;
    const lineas = (tr.lineas as unknown[]).map(linea);
    if (lineas.some((l) => l === null)) return null;
    trozos.push({ saltadas: tr.saltadas, lineas: lineas as LineaDelDiff[] });
  }
  return { ruta: f.ruta, tipo: f.tipo!, anadidas: f.anadidas, quitadas: f.quitadas, trozos, ocultas: f.ocultas };
}

/**
 * Lo que llega del evento o de la transcripción, comprobado: null si no tiene
 * la forma. Lo escribe sólo nuestro servidor, pero lo pinta el navegador.
 */
export function leerCambiosDelComando(x: unknown): CambiosDelComando | null {
  const c = x as Partial<CambiosDelComando> | null;
  if (!c || typeof c !== "object" || !Array.isArray(c.ficheros) || !entero(c.masFicheros)) return null;
  const ficheros = (c.ficheros as unknown[]).map(fichero);
  if (ficheros.some((f) => f === null)) return null;
  return { ficheros: ficheros as FicheroDelComando[], masFicheros: c.masFicheros };
}
