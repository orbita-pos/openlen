/**
 * EDIT, con el contrato de Claude Code (plans/len-2/ficheros-plan.md §A).
 *
 * Es la herramienta que faltaba: en la grabación de `encargo-grande` Len
 * retecleó 8.845 caracteres de JavaScript para quitar la gorra y se dejó las
 * zapatillas, porque `editar_runtime` le pedía «el código COMPLETO». Aquí se
 * cambia un trozo exacto y único, y lo que no se nombra no se toca.
 *
 * Esto PLANEA la edición y no guarda nada: guardar es asíncrono, pasa por la
 * puerta de siempre (`lib/page-engine`) y puede negarse. Quien lo llama guarda
 * `contenido` y, si sale bien, contesta con `respuesta`.
 */
import { paginaDeRuta, resolverRuta } from "./sitio";
import { noExiste, normalizarFinales, type Leidos, type SitioLegible } from "./read";
import { fallo, type Resultado } from "./resultado";
import { esDeLaPlataforma, MANUAL_SOLO_LECTURA } from "./manual";

export interface EntradaEdit {
  readonly file_path: string;
  readonly old_string: string;
  readonly new_string: string;
  readonly replace_all?: boolean;
}

export type PlanDeEdit =
  | { readonly ok: false; readonly resultado: Resultado }
  | {
      readonly ok: true;
      /** La ruta absoluta del fichero. */
      readonly ruta: string;
      /** El fichero entero tal como debe quedar, con SUS finales de línea. */
      readonly contenido: string;
      /** El fichero no existía: la edición lo crea. */
      readonly crea: boolean;
      /** Lo que se le contesta al modelo si guardar sale bien. `guardadoIgual`
       *  es si lo guardado es exactamente `contenido`: si la puerta añadió algo,
       *  no se le promete que su copia está al día. */
      respuesta(o: { guardadoIgual: boolean }): string;
    };

/** Los nombres de parámetro de otros modelos. Se queda sólo con los
 *  cuatro que existen. */
export function coercerEntradaEdit(raw: Record<string, unknown>): EntradaEdit {
  const texto = (v: unknown): string => (typeof v === "string" ? v : "");
  const file_path = typeof raw.file_path === "string" ? raw.file_path : texto(raw.path);
  const old_string = typeof raw.old_string === "string" ? raw.old_string : texto(raw.old_str);
  const new_string = typeof raw.new_string === "string" ? raw.new_string : texto(raw.new_str);
  let replace_all: boolean | undefined;
  if ("replace_all" in raw) replace_all = raw.replace_all === true;
  else if ("replace_name" in raw) replace_all = raw.replace_name === true || raw.replace_name === "true";
  return { file_path, old_string, new_string, ...(replace_all !== undefined ? { replace_all } : {}) };
}

export const NOTA_ESTADO_AL_DIA = " (what you sent is exactly what was saved: no need to Read it again)";
const NOTA_CAMBIADO_EN_DISCO =
  " (note: the file had changed since your last Read of it. Your edit applied, but other parts differ from what you saw: Read it again before an edit that depends on what is around it.)";
export const NO_LEIDO = "You have not read this file in this conversation. Read it before changing it.";
export const CAMBIADO_DESDE_LA_LECTURA =
  "This file changed after you read it (the user may have edited it). Read it again before changing it.";

export function planearEdit(entrada: EntradaEdit, sitio: SitioLegible, leidos: Leidos): PlanDeEdit {
  const { old_string: viejo, new_string: nuevo } = entrada;
  const replaceAll = entrada.replace_all ?? false;
  const ruta = resolverRuta(entrada.file_path);
  const no = (mensaje: string): PlanDeEdit => ({ ok: false, resultado: fallo(mensaje) });

  if (esDeLaPlataforma(ruta)) return no(MANUAL_SOLO_LECTURA);
  if (viejo === nuevo) return no("old_string and new_string are identical: there is nothing to change.");

  const crudo = sitio.contenido(ruta);
  if (crudo === null) {
    if (viejo !== "" || !paginaDeRuta(ruta)) return no(noExiste(ruta, sitio.ficheros));
    return {
      ok: true,
      ruta,
      contenido: nuevo,
      crea: true,
      respuesta: ({ guardadoIgual }) =>
        `Edited ${entrada.file_path}.${guardadoIgual ? NOTA_ESTADO_AL_DIA : ""}`,
    };
  }
  const actual = normalizarFinales(crudo);
  if (viejo === "" && actual.trim() !== "") return no("This file already has content, so old_string cannot be empty: pass the exact text you want to replace.");

  const lectura = leidos.get(ruta);
  if (!lectura || lectura.vistaParcial) return no(NO_LEIDO);
  // «Cambió desde que lo leíste». Si el trozo sigue casando y es único,
  // Claude Code aplica igual y lo dice; si no, pide releer.
  const cambiado = lectura.instantanea !== actual;
  if (cambiado && seAplica(actual, viejo, replaceAll) !== "aplica") return no(CAMBIADO_DESDE_LA_LECTURA);

  const encontrado = buscarTrozo(actual, viejo);
  if (encontrado === null) {
    const nota = conEscapesOAcentos(viejo)
      ? "\n(Edit also tried old_string with its \\uXXXX escapes turned into characters and the other way round; neither matched, so the difference is somewhere else. Read the file again and copy the text exactly.)"
      : "";
    return no(`old_string is not in the file.\nold_string: ${viejo}${nota}`);
  }
  const veces = actual.split(encontrado).length - 1;
  if (veces > 1 && !replaceAll) {
    return no(
      `old_string appears ${veces} times in the file. To change all of them, set replace_all to true; to change one, include more of the text around it so it matches only there.\nold_string: ${viejo}`,
    );
  }

  const nuevoAjustado = ajustarEscapes(viejo, encontrado, ajustarComillas(viejo, encontrado, nuevo));
  const editado = reemplazar(actual, encontrado, nuevoAjustado, replaceAll);
  if (editado === actual) return no("The edit would leave the file exactly as it was: nothing was changed.");
  const conSusFinales = crudo.includes("\r\n") ? editado.replaceAll("\n", "\r\n") : editado;

  const nota = (guardadoIgual: boolean) =>
    cambiado ? NOTA_CAMBIADO_EN_DISCO : guardadoIgual ? NOTA_ESTADO_AL_DIA : "";
  return {
    ok: true,
    ruta,
    contenido: conSusFinales,
    crea: false,
    respuesta: ({ guardadoIgual }) =>
      replaceAll
        ? `Edited ${entrada.file_path}: every copy of old_string was replaced.${nota(guardadoIgual)}`
        : `Edited ${entrada.file_path}.${nota(guardadoIgual)}`,
  };
}

/** ¿Se aplicaría la edición tal cual está el fichero? */
function seAplica(contenido: string, viejo: string, replaceAll: boolean): "no_casa" | "ambigua" | "aplica" {
  if (viejo === "") return "no_casa";
  const trozo = buscarTrozo(contenido, viejo);
  if (!trozo) return "no_casa";
  if (!replaceAll) {
    const primero = contenido.indexOf(trozo);
    if (contenido.indexOf(trozo, primero + trozo.length) !== -1) return "ambigua";
  }
  return "aplica";
}

/** Como Claude Code: vaciar un trozo que no acaba en salto de línea se lleva también el
 *  salto que le sigue, para no dejar una línea en blanco. */
function reemplazar(contenido: string, viejo: string, nuevo: string, todas: boolean): string {
  const cambia = (texto: string, de: string, a: string) =>
    todas ? texto.replaceAll(de, () => a) : texto.replace(de, () => a);
  if (nuevo !== "") return cambia(contenido, viejo, nuevo);
  return !viejo.endsWith("\n") && contenido.includes(viejo + "\n")
    ? cambia(contenido, viejo + "\n", nuevo)
    : cambia(contenido, viejo, nuevo);
}

// ─── Casar el trozo, como Claude Code ──────────────────────────────────────

const COMILLA_SIMPLE_ABRE = "‘";
const COMILLA_SIMPLE_CIERRA = "’";
const COMILLA_DOBLE_ABRE = "“";
const COMILLA_DOBLE_CIERRA = "”";
const ESCAPE_U = /\\u[0-9a-fA-F]{4}/;
const NO_ASCII = /[\u0080-￿]/;

/** ¿Lleva un `\uXXXX` o un carácter no-ASCII? */
function conEscapesOAcentos(texto: string): boolean {
  return ESCAPE_U.test(texto) || NO_ASCII.test(texto);
}

/** Las comillas tipográficas, como rectas. */
function comillasRectas(texto: string): string {
  return texto
    .replaceAll(COMILLA_SIMPLE_ABRE, "'")
    .replaceAll(COMILLA_SIMPLE_CIERRA, "'")
    .replaceAll(COMILLA_DOBLE_ABRE, '"')
    .replaceAll(COMILLA_DOBLE_CIERRA, '"');
}

/** Los `\uXXXX` como sus caracteres (respetando `\\`). */
function desescapar(texto: string): string {
  return texto.replace(/(\\\\)|\\u([0-9a-fA-F]{4})/g, (todo, barras, hex) =>
    barras !== undefined ? todo : String.fromCharCode(parseInt(hex as string, 16)),
  );
}

function escaparRegExp(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Una expresión que casa el texto con cada carácter no-ASCII escrito
 *  como `\uXXXX` (en mayúsculas o minúsculas). */
function patronEscapado(texto: string): string {
  let patron = "";
  for (let i = 0; i < texto.length; i++) {
    const codigo = texto.charCodeAt(i);
    if (codigo >= 128) {
      patron += "\\\\u";
      for (const h of codigo.toString(16).padStart(4, "0")) {
        patron += h >= "a" ? `[${h}${h.toUpperCase()}]` : h;
      }
    } else patron += escaparRegExp(texto[i]!);
  }
  return patron;
}

/** Lo que mide el texto con los no-ASCII escritos como `\uXXXX`. */
function largoEscapado(texto: string): number {
  let noAscii = 0;
  for (let i = 0; i < texto.length; i++) if (texto.charCodeAt(i) >= 128) noAscii++;
  return texto.length + 5 * noAscii;
}

/** Cuántas barras invertidas hay justo antes de `posicion`. */
function barrasAntes(texto: string, posicion: number): number {
  let n = 0;
  while (texto[posicion - 1 - n] === "\\") n++;
  return n;
}

/** El trozo del fichero que es `texto` con sus no-ASCII escapados. */
function buscarEscapado(texto: string, contenido: string): string | null {
  if (barrasAntes(texto, texto.length) % 2 === 1) return null;
  const posiciones: number[] = texto[0] === "\\" ? [0] : [];
  let desplazado = 0;
  for (let i = 0; i < texto.length; i++) {
    if (texto.charCodeAt(i) >= 128) {
      posiciones.push(desplazado);
      desplazado += 6;
    } else desplazado += 1;
  }
  try {
    const re = new RegExp(patronEscapado(texto), "g");
    for (let m = re.exec(contenido); m !== null; m = re.exec(contenido)) {
      const donde = m.index;
      if (posiciones.every((p) => barrasAntes(contenido, donde + p) % 2 === 0)) {
        return contenido.indexOf(m[0]) === donde ? m[0] : null;
      }
      re.lastIndex = donde + 1;
    }
    return null;
  } catch {
    return null;
  }
}

/** El trozo del fichero que casa con `viejo` — exacto, o con comillas
 *  tipográficas, o con `\uXXXX` en cualquiera de las dos direcciones. */
function buscarTrozo(contenido: string, viejo: string): string | null {
  if (contenido.includes(viejo)) return viejo;
  const donde = comillasRectas(contenido).indexOf(comillasRectas(viejo));
  if (donde !== -1) return contenido.substring(donde, donde + viejo.length);
  if (ESCAPE_U.test(viejo)) {
    const sinEscapes = desescapar(viejo);
    if (sinEscapes !== viejo && contenido.includes(sinEscapes)) return sinEscapes;
  }
  if (NO_ASCII.test(viejo)) {
    if (largoEscapado(viejo) > contenido.length || !contenido.includes("\\u")) return null;
    return buscarEscapado(viejo, contenido);
  }
  return null;
}

/** ¿Esta comilla abre? (va al principio o tras un espacio o apertura). */
function abre(caracteres: readonly string[], i: number): boolean {
  if (i === 0) return true;
  const antes = caracteres[i - 1];
  return (
    antes === " " || antes === "\t" || antes === "\n" || antes === "\r" ||
    antes === "(" || antes === "[" || antes === "{" || antes === "—" || antes === "–"
  );
}

/** Si el trozo del fichero usaba comillas tipográficas, lo nuevo también. */
function ajustarComillas(viejo: string, encontrado: string, nuevo: string): string {
  if (viejo === encontrado) return nuevo;
  const dobles = encontrado.includes(COMILLA_DOBLE_ABRE) || encontrado.includes(COMILLA_DOBLE_CIERRA);
  const simples = encontrado.includes(COMILLA_SIMPLE_ABRE) || encontrado.includes(COMILLA_SIMPLE_CIERRA);
  let texto = nuevo;
  if (dobles) {
    const c = [...texto];
    texto = c.map((x, i) => (x === '"' ? (abre(c, i) ? COMILLA_DOBLE_ABRE : COMILLA_DOBLE_CIERRA) : x)).join("");
  }
  if (simples) {
    const c = [...texto];
    texto = c
      .map((x, i) => {
        if (x !== "'") return x;
        const letraAntes = i > 0 && /\p{L}/u.test(c[i - 1]!);
        const letraDespues = i < c.length - 1 && /\p{L}/u.test(c[i + 1]!);
        if (letraAntes && letraDespues) return COMILLA_SIMPLE_CIERRA;
        return abre(c, i) ? COMILLA_SIMPLE_ABRE : COMILLA_SIMPLE_CIERRA;
      })
      .join("");
  }
  return texto;
}

/** Si el trozo casó por sus escapes `\uXXXX`, lo nuevo se escribe con
 *  la misma forma (y con las mismas mayúsculas en el hexadecimal). */
function ajustarEscapes(viejo: string, encontrado: string, nuevo: string): string {
  if (viejo === encontrado) return nuevo;
  if (NO_ASCII.test(viejo) && largoEscapado(viejo) === encontrado.length && buscarEscapado(viejo, encontrado) !== null) {
    const escapes = new Map<number, string>();
    let mayusculas = 0;
    let minusculas = 0;
    for (let i = 0, j = 0; i < viejo.length; i++) {
      const codigo = viejo.charCodeAt(i);
      if (codigo >= 128) {
        const hex = encontrado.slice(j + 2, j + 6);
        escapes.set(codigo, hex);
        for (const h of hex) {
          if (h >= "a" && h <= "f") minusculas++;
          else if (h >= "A" && h <= "F") mayusculas++;
        }
        j += 6;
      } else j += 1;
    }
    return nuevo.replace(/[\u0080-￿]/g, (c) => {
      const codigo = c.charCodeAt(0);
      const conocido = escapes.get(codigo);
      if (conocido !== undefined) return "\\u" + conocido;
      const hex = codigo.toString(16).padStart(4, "0");
      return "\\u" + (mayusculas > minusculas ? hex.toUpperCase() : hex);
    });
  }
  if (ESCAPE_U.test(viejo) && desescapar(viejo) === encontrado) return desescapar(nuevo);
  return nuevo;
}
