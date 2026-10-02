/**
 * READ, con el contrato de Claude Code (plans/len-2/ficheros-plan.md §A).
 *
 * Se sigue lo que hace Claude Code, no lo que dice su descripción: la
 * descripción dice «hasta 2.000 líneas», y sin `limit` devuelve el fichero
 * ENTERO. Lo que corta de verdad son los 25.000 tokens y los 256 KB.
 */
import { CWD, resolverRuta, sugerirRuta } from "./sitio";
import { exito, fallo, formatoDeBytes, type Resultado } from "./resultado";

/** El tope de tokens de una lectura, el de Claude Code. */
export const TOPE_DE_TOKENS = 25_000;
/** El tope de bytes de una lectura sin `limit`. */
export const TOPE_DE_BYTES = 262_144;
/** Por encima de tokens·128 caracteres ni se cuenta. */
const CARACTERES_POR_TOKEN_MAXIMO = 128;

/**
 * Lo que queda apuntado de una lectura, como lo apunta Claude Code.
 *
 * `instantanea` es el fichero ENTERO tal como estaba al leerlo, y hace de
 * «fecha»: en OpenLen no hay fecha por página (`updatedAt` sube con cualquier
 * ajuste de cualquier página), así que «cambió desde que lo leíste» es «su
 * contenido ya no es éste». Es la segunda comprobación de Claude Code
 * usada como única — ver el plan, decisión B2.
 *
 * `offset` ausente = lo apuntó una escritura (Edit/Write), como en Claude Code:
 * así una relectura tras editar no se da por tirada.
 */
export interface Lectura {
  readonly instantanea: string;
  readonly offset: number | undefined;
  readonly limit: number | undefined;
  /** La lectura se paginó sola porque no cabía: no vale para editar. */
  readonly vistaParcial?: true;
}

/** Lo leído en ESTE turno, por ruta absoluta. Empieza vacío cada turno: el
 *  historial de Len no lleva el contenido de las lecturas (decisión B3). */
export type Leidos = Map<string, Lectura>;

/** Lo que Read necesita del sitio. */
export interface SitioLegible {
  contenido(ruta: string): string | null;
  readonly ficheros: readonly string[];
}

export interface EntradaRead {
  readonly file_path: string;
  readonly offset?: number;
  readonly limit?: number;
}

/** Lo más larga que llega una línea al modelo. Lo que pasa se corta y se avisa,
 *  como en el arnés de DeepSeek (`read-render.ts`, READ_MAX_LINE_LENGTH), con su
 *  mismo aviso: V4.1 se evaluó con ese arnés. Decidido por Jesús el 2026-10-01
 *  tras el turno fbc761a9: un favicon en base64, dentro de una línea de 7.290
 *  caracteres que escribe OpenLen, le costó 20 vueltas a Len. Medido ese día en
 *  la base de desarrollo: oculta el 40 % de los caracteres de las páginas — dos
 *  tercios, bloques `data-ol-*` de OpenLen; uno, CSS/HTML del modelo en líneas
 *  largas (29 % de las páginas). Jesús eligió el corte tal cual sabiéndolo.
 *  Claude Code NO corta (medido en su arnés): esto es de DeepSeek. */
export const TOPE_DE_LINEA = 2000;
const AVISO_DE_CORTE = `... (line truncated to ${TOPE_DE_LINEA} chars)`;

/** La línea tal cual, o su principio y el aviso si pasa del tope. Sin partir un
 *  carácter en dos: si el corte cae en medio de un par sustituto, se queda fuera. */
export function cortarLinea(linea: string): string {
  if (linea.length <= TOPE_DE_LINEA) return linea;
  let principio = linea.slice(0, TOPE_DE_LINEA);
  const ultimo = principio.charCodeAt(principio.length - 1);
  if (ultimo >= 0xd800 && ultimo <= 0xdbff) principio = principio.slice(0, -1);
  return `${principio}${AVISO_DE_CORTE}`;
}

/** Número, tabulador y la línea tal cual; sin relleno y sin el `\r` final,
 *  como lo enseña Claude Code. */
export function formatoCatN(contenido: string, primeraLinea: number): string {
  return contenido
    .split("\n")
    .map((linea, i) => `${primeraLinea + i}\t${linea.endsWith("\r") ? linea.slice(0, -1) : linea}`)
    .join("\n");
}

/** Cuatro caracteres por token. Claude Code cuenta de verdad con la
 *  API cuando puede y cae a esto cuando no; aquí no hay API que contar. */
export function estimarTokens(texto: string): number {
  return Math.round(texto.length / 4);
}

/** El contenido que ven las herramientas: LF, como en Claude Code. */
export function normalizarFinales(texto: string): string {
  const lf = texto.includes("\r") ? texto.replaceAll("\r\n", "\n") : texto;
  return lf.endsWith("\r") ? lf.slice(0, -1) : lf;
}

export function noExiste(ruta: string, ficheros: readonly string[]): string {
  const parecido = sugerirRuta(ruta, ficheros);
  return `There is no file at ${ruta}. Paths start at the site root, ${CWD}.${parecido ? ` Did you mean ${parecido}?` : ""}`;
}

const CARTEL = "[Partial view — ";
const TIRADA =
  "This Read was not needed: the file has not changed since your last Read of it. Use what that earlier Read returned.";

function demasiadosTokens(tokens: number): string {
  return `This file is ${tokens} tokens long and one Read returns at most ${TOPE_DE_TOKENS}. Read it in parts with offset and limit, or use Grep to find the part you need.`;
}

export function ejecutarRead(entrada: EntradaRead, sitio: SitioLegible, leidos: Leidos): Resultado {
  const ruta = resolverRuta(entrada.file_path);
  const offset = entrada.offset ?? 1;
  const limit = entrada.limit;
  const crudo = sitio.contenido(ruta);
  if (crudo === null) return fallo(noExiste(ruta, sitio.ficheros));
  const entero = normalizarFinales(crudo);

  // DEDUPE: la misma lectura, sobre el mismo fichero, sin cambios. Sólo si la
  // anterior la hizo Read (offset apuntado) y no fue una vista parcial.
  const previa = leidos.get(ruta);
  if (
    previa &&
    !previa.vistaParcial &&
    previa.offset !== undefined &&
    previa.offset === offset &&
    previa.limit === limit &&
    previa.instantanea === entero
  ) {
    return exito(TIRADA);
  }

  // Sin `limit`, el tope de bytes va sobre el fichero tal cual está guardado.
  if (limit === undefined) {
    const bytes = Buffer.byteLength(crudo, "utf8");
    if (bytes > TOPE_DE_BYTES) {
      return fallo(
        `This file is ${formatoDeBytes(bytes)} and a Read without limit returns at most ${formatoDeBytes(TOPE_DE_BYTES)}. Read it in parts with offset and limit, or use Grep to find the part you need.`,
      );
    }
  }

  const lineas = entero.split("\n");
  const desde = offset === 0 ? 0 : offset - 1;
  const hasta = limit === undefined ? lineas.length : desde + limit;
  // Cada línea, cortada ANTES de contar: los topes de tokens y la paginación
  // miden lo que de verdad le llega al modelo (como DeepSeek, que corta la línea
  // y después aplica su tope de salida). Lo apuntado como leído sigue siendo el
  // fichero ENTERO: cortar no hace la vista parcial ni impide editar.
  const tramo = lineas.slice(desde, hasta).map(cortarLinea);
  let contenido = tramo.join("\n");
  // Una línea mal numerada engaña al modelo: Claude Code numeraría un offset=0
  // desde 0. Aquí se numera desde 1, que es la línea que de verdad es.
  const primeraLinea = Math.max(1, offset);
  let lineasDadas = tramo.length;
  let limitApuntado = limit;
  let cartel: string | undefined;

  const estimados = estimarTokens(contenido);
  if (estimados > TOPE_DE_TOKENS / 4) {
    const entera = offset <= 1 && limit === undefined;
    if (!entera && contenido.length > TOPE_DE_TOKENS * CARACTERES_POR_TOKEN_MAXIMO) {
      return fallo(demasiadosTokens(estimados));
    }
    if (estimados > TOPE_DE_TOKENS) {
      if (!entera) return fallo(demasiadosTokens(estimados));
      const pagina = paginar(contenido, estimados, ruta, lineas.length);
      contenido = pagina.contenido;
      lineasDadas = pagina.lineas;
      limitApuntado = pagina.lineas;
      cartel = pagina.cartel;
    }
  }

  leidos.set(ruta, {
    instantanea: entero,
    offset,
    limit: limitApuntado,
    ...(cartel !== undefined ? { vistaParcial: true as const } : {}),
  });

  let texto: string;
  if (contenido) texto = formatoCatN(contenido, primeraLinea);
  else if (lineasDadas >= 1 && lineas.length > 1) texto = `${primeraLinea}\t`;
  else if (lineasDadas >= 1 || lineas.length === 0) {
    texto = "<system-reminder>This file exists and is empty.</system-reminder>";
  } else {
    texto = `<system-reminder>This file has only ${lineas.length} lines, so there is nothing from line ${offset} on.</system-reminder>`;
  }
  return exito(cartel ? `${texto}\n\n${cartel}` : texto);
}

/**
 * El auto-paginado de una lectura entera que no cabe, como en Claude Code: primero por
 * líneas (las que caben en proporción, con un 15 % de margen, y un 30 % menos
 * hasta seis veces); si ni una línea cabe, por caracteres.
 *
 * ⚠️ Desde B (01/10/2026) las líneas llegan aquí ya cortadas a `TOPE_DE_LINEA`,
 * así que la rama «por caracteres» no se alcanza: una línea de 2.034 caracteres
 * siempre cabe en 25.000 tokens. Se queda como red por si el tope de línea cambia.
 */
function paginar(
  todo: string,
  tokens: number,
  ruta: string,
  totalLineas: number,
): { contenido: string; lineas: number; cartel: string } {
  const lineas = todo.split("\n");
  const caracteresPorToken = Math.max(0.5, todo.length / Math.max(1, tokens));
  const cuesta = (s: string) => s.length / caracteresPorToken;
  let cuantas = Math.max(
    1,
    Math.min(lineas.length, Math.floor(((lineas.length * TOPE_DE_TOKENS) / Math.max(1, tokens)) * 0.85)),
  );
  let trozo = lineas.slice(0, cuantas).join("\n");
  for (let i = 0; i < 6; i++) {
    if (cuesta(trozo) <= TOPE_DE_TOKENS || cuantas <= 1) break;
    cuantas = Math.max(1, Math.floor(cuantas * 0.7));
    trozo = lineas.slice(0, cuantas).join("\n");
  }
  let porCaracteres = false;
  if (cuesta(trozo) > TOPE_DE_TOKENS || trozo.trim() === "") {
    let caracteres = Math.max(1, Math.floor(TOPE_DE_TOKENS * caracteresPorToken * 0.85));
    for (let i = 0; i < 6; i++) {
      trozo = todo.slice(0, caracteres);
      if (cuesta(trozo) <= TOPE_DE_TOKENS) break;
      caracteres = Math.max(1, Math.floor(caracteres * 0.7));
    }
    const ultimo = trozo.charCodeAt(trozo.length - 1);
    if (ultimo >= 0xd800 && ultimo <= 0xdbff) trozo = trozo.slice(0, -1);
    porCaracteres = true;
  }
  const dadas = porCaracteres ? trozo.split("\n").length : cuantas;
  const cartel =
    !porCaracteres && dadas < totalLineas
      ? `${CARTEL}${ruta}: lines 1-${dadas} of ${totalLineas} (the file is ${tokens} tokens; one Read returns up to ${TOPE_DE_TOKENS}). For the next part, Read with offset=${dadas + 1} limit=${dadas}, or Grep for the section you need. What you are looking for may be further down: do NOT base your answer on this part alone.]`
      : `${CARTEL}${ruta}: the first ${trozo.length} of ${todo.length} characters (the file is ${tokens} tokens; one Read returns up to ${TOPE_DE_TOKENS}). Its lines are too long to split by line: Grep for the section you need, or Read with offset/limit to go through it. What you are looking for may be elsewhere: do NOT base your answer on this excerpt alone.]`;
  return { contenido: trozo, lineas: dadas, cartel };
}
