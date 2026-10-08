/**
 * GREP, con el contrato de Claude Code (plans/len-2/ficheros-plan.md §A).
 *
 * Claude Code llama a ripgrep y da forma a su salida. Aquí no hay
 * ripgrep ni disco: una RegExp de JS sobre los ficheros del sitio, con la
 * semántica de rg que el modelo conoce —`-i`, `-n`, `-A/-B/-C`, `-o`,
 * `multiline`, `glob`, `type`— y la salida que Claude Code le da. Dicho en voz
 * alta: la sintaxis es la de JavaScript, no la de Rust; casi siempre coinciden.
 */
import { CWD, alcanceDeBusqueda, rutaRelativa, sugerirRuta } from "./sitio";
import { normalizarFinales, type SitioLegible } from "./read";
import { partirGlobs, pasaLosGlobs } from "./patron-glob";
import { exito, fallo, formatoDeBytes, type Resultado } from "./resultado";

export interface EntradaGrep {
  readonly pattern: string;
  readonly path?: string;
  readonly glob?: string;
  readonly type?: string;
  readonly output_mode?: "content" | "files_with_matches" | "count";
  readonly "-B"?: number;
  readonly "-A"?: number;
  readonly "-C"?: number;
  readonly context?: number;
  readonly "-n"?: boolean;
  readonly "-i"?: boolean;
  readonly "-o"?: boolean;
  readonly head_limit?: number;
  readonly offset?: number;
  readonly multiline?: boolean;
}

/** Lo que Grep y Glob necesitan del sitio. `recientes`: lo escrito en este
 *  turno, lo más reciente primero — Claude Code ordena por fecha y aquí no hay
 *  fecha por página (decisión B6). */
export interface SitioBuscable extends SitioLegible {
  readonly recientes?: readonly string[];
}

/** Cuántas entradas se dan si no se pide otra cosa. */
export const TOPE_POR_DEFECTO = 250;
/** `--max-columns 500`: una línea más larga no se enseña. */
const COLUMNAS = 500;
/** `maxResultSizeChars` de Grep. */
export const TOPE_DE_CARACTERES = 20_000;

/** `head_limit` y `offset`, como `| tail -n +N | head -N`. */
export function paginarEntradas<T>(
  entradas: readonly T[],
  limite: number | undefined,
  desde = 0,
): { entradas: T[]; limiteAplicado?: number } {
  if (limite === 0) return { entradas: entradas.slice(desde) };
  const tope = limite ?? TOPE_POR_DEFECTO;
  const trozo = entradas.slice(desde, desde + tope);
  return entradas.length - desde > tope ? { entradas: trozo, limiteAplicado: tope } : { entradas: trozo };
}

/** «limit: 250, offset: 10», sólo lo que aplica. */
function paginacion(limite: number | undefined, desde: number | undefined): string {
  const partes: string[] = [];
  if (limite !== undefined) partes.push(`limit: ${limite}`);
  if (desde) partes.push(`offset: ${desde}`);
  return partes.join(", ");
}

/** Lo escrito en este turno primero; luego por ruta. */
export function ordenPorFecha(rutas: readonly string[], recientes: readonly string[] = []): string[] {
  const edad = (r: string) => {
    const i = recientes.indexOf(r);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return [...rutas].sort((a, b) => edad(a) - edad(b) || a.localeCompare(b));
}

/** Corta un resultado que pasa del tope. Claude Code lo guardaría en disco y
 *  enseñaría un avance; aquí no hay disco, así que se dice cómo ver el resto. */
export function recortarResultado(texto: string, tope: number): string {
  if (texto.length <= tope) return texto;
  const corte = texto.lastIndexOf("\n", tope);
  const dado = corte > 0 ? texto.slice(0, corte) : texto.slice(0, tope);
  return `${dado}\n\n[Result cut: the first ${formatoDeBytes(Buffer.byteLength(dado, "utf8"))} of ${formatoDeBytes(Buffer.byteLength(texto, "utf8"))}. Page through the rest with head_limit and offset, or narrow the pattern.]`;
}

/** Los tipos de `rg --type` que tienen sentido aquí, con sus extensiones. */
const TIPOS: Readonly<Record<string, readonly string[]>> = {
  html: [".html", ".htm"],
  js: [".js", ".jsx", ".mjs", ".cjs"],
  ts: [".ts", ".tsx", ".mts", ".cts"],
  css: [".css"],
  json: [".json", ".webmanifest"],
  md: [".md", ".markdown"],
  markdown: [".md", ".markdown"],
  sql: [".sql"],
  svg: [".svg"],
  txt: [".txt"],
};

export function ejecutarGrep(entrada: EntradaGrep, sitio: SitioBuscable): Resultado {
  for (const [nombre, valor] of [["head_limit", entrada.head_limit], ["offset", entrada.offset]] as const) {
    if (valor !== undefined && (!Number.isInteger(valor) || valor < 0)) {
      return fallo(`${nombre} has to be a whole number, 0 or more (got ${valor}).${nombre === "head_limit" ? " 0 means no limit." : ""}`);
    }
  }
  const alcance = alcanceDeBusqueda(entrada.path, sitio.ficheros);
  if (alcance === null) {
    const parecido = sugerirRuta(entrada.path ?? CWD, sitio.ficheros);
    return fallo(
      `There is no file or folder ${entrada.path}. Paths start at the site root, ${CWD}.${parecido ? ` Did you mean ${parecido}?` : ""}`,
    );
  }

  const modo = entrada.output_mode ?? "files_with_matches";
  const conNumeros = entrada["-n"] ?? true;
  const desde = entrada.offset ?? 0;
  let expresion: RegExp;
  try {
    expresion = new RegExp(entrada.pattern, `g${entrada["-i"] ? "i" : ""}${entrada.multiline ? "ms" : ""}`);
  } catch (err) {
    return fallo(err instanceof Error ? err.message : String(err));
  }

  const esCarpeta = "carpeta" in alcance;
  const raiz = esCarpeta ? alcance.carpeta : "/";
  const globs = entrada.glob ? partirGlobs(entrada.glob) : [];
  const candidatos = (esCarpeta ? alcance.ficheros : [alcance.fichero]).filter((ruta) => {
    const relativa = ruta.slice(raiz === "/" ? 1 : raiz.length + 1);
    if (!pasaLosGlobs(relativa, globs)) return false;
    // ⚰️ Decía «todo el sitio es HTML: `--type html` lo deja todo y cualquier
    // otro nada». Dejó de ser verdad con la carpeta (pieza 9), y en una app el
    // código entero es .jsx: `type: "js"` no encontraba nada. Ahora, por su
    // extensión, como `rg --type`.
    if (entrada.type === undefined || entrada.type === "") return true;
    return (TIPOS[entrada.type] ?? []).some((ext) => ruta.toLowerCase().endsWith(ext));
  });
  if (entrada.type && !Object.hasOwn(TIPOS, entrada.type)) {
    return fallo(`unrecognized file type: ${entrada.type}. Known types: ${Object.keys(TIPOS).join(", ")}.`);
  }
  const ordenados = [...candidatos].sort((a, b) => a.localeCompare(b));

  const porFichero = ordenados.map((ruta) => ({
    ruta,
    lineas: lineasQueCasan(normalizarFinales(sitio.contenido(ruta) ?? ""), expresion, entrada.multiline === true),
  }));
  const conAlgo = porFichero.filter((f) => f.lineas.size > 0);

  if (modo === "files_with_matches") {
    const todos = ordenPorFecha(conAlgo.map((f) => f.ruta), sitio.recientes);
    const { entradas, limiteAplicado } = paginarEntradas(todos, entrada.head_limit, desde);
    const pag = paginacion(limiteAplicado, desde);
    if (entradas.length === 0) {
      return exito(desde && todos.length > 0 ? `Nothing left from this offset on. [page: ${pag}]` : "No file matches.");
    }
    const cabecera = `${entradas.length} matching ${entradas.length === 1 ? "file" : "files"}${pag ? ` (${pag})` : ""}`;
    return exito(recortarResultado([cabecera, ...entradas.map(rutaRelativa)].join("\n"), TOPE_DE_CARACTERES));
  }

  if (modo === "count") {
    const lineas = conAlgo.map((f) => `${rutaRelativa(f.ruta)}:${f.lineas.size}`);
    const total = conAlgo.reduce((n, f) => n + f.lineas.size, 0);
    const { entradas, limiteAplicado } = paginarEntradas(lineas, entrada.head_limit, desde);
    const pag = paginacion(limiteAplicado, desde);
    const cuerpo = entradas.join("\n") || (total > 0 ? "Nothing left from this offset on." : "No line matches.");
    const pie = `\n\n${total} ${total === 1 ? "match" : "matches"} in ${conAlgo.length} ${conAlgo.length === 1 ? "file" : "files"}.${pag ? ` Page: ${pag}.` : ""}`;
    return exito(recortarResultado(cuerpo + pie, TOPE_DE_CARACTERES));
  }

  // content
  const antes = entrada.context ?? entrada["-C"] ?? entrada["-B"] ?? 0;
  const despues = entrada.context ?? entrada["-C"] ?? entrada["-A"] ?? 0;
  const conCortes = [entrada.context, entrada["-C"], entrada["-B"], entrada["-A"]].some((v) => typeof v === "number" && v > 0);
  const salida: string[] = [];
  let ultimo: { ruta: string; linea: number } | null = null;
  for (const { ruta, lineas } of conAlgo) {
    const texto = normalizarFinales(sitio.contenido(ruta) ?? "").split("\n");
    const prefijo = (numero: number, sep: ":" | "-") => {
      const conNumero = conNumeros ? `${numero}${sep}` : "";
      return esCarpeta ? `${rutaRelativa(ruta)}${conNumeros ? sep : ":"}${conNumero}` : conNumero;
    };
    if (entrada["-o"]) {
      for (const i of [...lineas.keys()].sort((a, b) => a - b)) {
        for (const m of texto[i]!.matchAll(new RegExp(expresion.source, expresion.flags))) {
          if (m[0] === "") continue;
          salida.push(`${prefijo(i + 1, ":")}${cortar(m[0], true)}`);
        }
      }
      continue;
    }
    const aEnsenar = new Map<number, boolean>();
    for (const i of lineas.keys()) {
      for (let j = Math.max(0, i - antes); j <= Math.min(texto.length - 1, i + despues); j++) {
        if (!aEnsenar.has(j)) aEnsenar.set(j, false);
      }
    }
    for (const i of lineas.keys()) aEnsenar.set(i, true);
    for (const i of [...aEnsenar.keys()].sort((a, b) => a - b)) {
      if (conCortes && ultimo !== null && (ultimo.ruta !== ruta || i > ultimo.linea + 1)) salida.push("--");
      const casa = aEnsenar.get(i)!;
      salida.push(`${prefijo(i + 1, casa ? ":" : "-")}${cortar(texto[i]!, casa)}`);
      ultimo = { ruta, linea: i };
    }
  }
  const { entradas, limiteAplicado } = paginarEntradas(salida, entrada.head_limit, desde);
  const pag = paginacion(limiteAplicado, desde);
  const cuerpo = entradas.join("\n") || (desde && salida.length > 0 ? "Nothing left from this offset on." : "No line matches.");
  return exito(recortarResultado(pag ? `${cuerpo}\n\n[page: ${pag}]` : cuerpo, TOPE_DE_CARACTERES));
}

/** Una línea de más de 500 columnas no se enseña. */
function cortar(linea: string, casa: boolean): string {
  if (linea.length <= COLUMNAS) return linea;
  return casa ? "[matching line too long to show]" : "[context line too long to show]";
}

/**
 * Las líneas (índice desde 0) que casan. Sin `multiline`, línea a línea, como
 * rg. Con él, el patrón corre sobre el fichero entero y casa cada línea que
 * toque alguna coincidencia. El valor del mapa es cuántas veces casó.
 */
function lineasQueCasan(contenido: string, expresion: RegExp, multilinea: boolean): Map<number, number> {
  const resultado = new Map<number, number>();
  const re = new RegExp(expresion.source, expresion.flags);
  if (!multilinea) {
    contenido.split("\n").forEach((linea, i) => {
      re.lastIndex = 0;
      if (re.test(linea)) resultado.set(i, 1);
    });
    return resultado;
  }
  const inicios: number[] = [0];
  for (let i = 0; i < contenido.length; i++) if (contenido[i] === "\n") inicios.push(i + 1);
  const lineaDe = (pos: number) => {
    let lo = 0;
    let hi = inicios.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (inicios[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  for (const m of contenido.matchAll(re)) {
    const primera = lineaDe(m.index);
    const ultima = lineaDe(m.index + Math.max(0, m[0].length - 1));
    for (let l = primera; l <= ultima; l++) resultado.set(l, (resultado.get(l) ?? 0) + 1);
  }
  return resultado;
}
