/**
 * GLOB, con el contrato de Claude Code (plans/len-2/ficheros-plan.md §A):
 * 100 resultados como mucho, lo más reciente primero, «No files found» si nada.
 */
import { CWD, alcanceDeBusqueda, rutaRelativa, sugerirRuta } from "./sitio";
import { globARegExp } from "./patron-glob";
import { ordenPorFecha, type SitioBuscable } from "./grep";
import { exito, fallo, type Resultado } from "./resultado";

export interface EntradaGlob {
  readonly pattern: string;
  readonly path?: string;
}

/** `maxResults ?? 100`. */
export const TOPE_DE_RESULTADOS = 100;

export function ejecutarGlob(entrada: EntradaGlob, sitio: SitioBuscable): Resultado {
  // Un patrón absoluto lleva dentro su carpeta, como en Claude Code.
  const absoluto = entrada.pattern.startsWith("/");
  const alcance = alcanceDeBusqueda(absoluto ? CWD : entrada.path, sitio.ficheros);
  if (alcance === null) {
    const parecido = sugerirRuta(entrada.path ?? CWD, sitio.ficheros);
    return fallo(
      `There is no folder ${entrada.path}. Paths start at the site root, ${CWD}.${parecido ? ` Did you mean ${parecido}?` : ""}`,
    );
  }
  if ("fichero" in alcance) return fallo(`${entrada.path} is a file, not a folder: pass a folder as path, or leave path out.`);

  const patron = globARegExp(absoluto ? entrada.pattern.slice(1) : entrada.pattern);
  const raiz = alcance.carpeta;
  const casan = alcance.ficheros.filter((ruta) => patron.test(ruta.slice(raiz === "/" ? 1 : raiz.length + 1)));
  if (casan.length === 0) return exito("No file matches that pattern.");

  const ordenadas = ordenPorFecha(casan, sitio.recientes);
  const dadas = ordenadas.slice(0, TOPE_DE_RESULTADOS);
  const lineas = dadas.map(rutaRelativa);
  if (ordenadas.length > dadas.length) {
    lineas.push(
      `(${dadas.length} of ${ordenadas.length} matching files shown; ${ordenadas.length - dadas.length} left out. Use a narrower pattern or path to see them.)`,
    );
  }
  return exito(lineas.join("\n"));
}
