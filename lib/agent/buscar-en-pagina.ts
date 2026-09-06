// lib/agent/buscar-en-pagina.ts — encontrar un texto en el sitio, y decir por
// qué puerta se arregla.
//
// POR QUÉ EXISTE. El Agente sólo sabía mirar: `leer_estado` abre UNA sección
// por llamada y `ver_pagina` trae OTRA página entera. Para «cambia el teléfono
// en todo el sitio» eso son N vueltas del bucle —y cada vuelta reenvía todo el
// historial acumulado— o, peor, la respuesta que Jesús ya vio el 2026-08-31: lo
// arregló en la Home y dejó /nosotros igual, porque no la estaba mirando.
//
// 🔴 NO ES UN grep DE TEXTO SOBRE EL HTML. Se parsea el documento y se busca en
// los NODOS DE TEXTO y en un puñado de atributos, no en la sopa de marcado. Un
// grep encuentra «azul» dentro de `class="bg-azul"`, dentro de un comentario y
// dentro del `<style>`, y devuelve tres sitios donde no hay nada que cambiar.
// Es además la lección de `c10babe1`: las regex de este repo no cruzan un `>`.
//
// 🔴 Y DICE POR QUÉ PUERTA SE ARREGLA. Un texto puede vivir en cuatro sitios y
// `editar_pagina` tiene un `target` distinto para cada uno. Devolver sólo los
// del cuerpo dejaría al modelo arreglando lo que ve y diciéndole al usuario que
// ya está, con el teléfono viejo todavía en la `<meta description>` —que es lo
// que Google enseña— o dentro del script. Por eso `donde` viaja en cada
// coincidencia y `op_id` es `null` fuera del cuerpo: ahí no hay op-id que
// valga, y fabricar uno sería mentir sobre lo que se puede hacer con él.

import { NodeType, parse, type HTMLElement, type Node } from "node-html-parser";

/** Dónde apareció el texto — y, con ello, el `target` de `editar_pagina` que
 *  lo arregla. */
export type DondeCasa = "cuerpo" | "cabecera" | "script";

export interface Coincidencia {
  /** El slug, o "principal" para la Home — el mismo nombre que usa
   *  `trabajar_en_pagina`, para que el modelo pase de aquí a la herramienta sin
   *  traducir nada. */
  pagina: string;
  donde: DondeCasa;
  /** `null` fuera del cuerpo: la cabecera y el script no llevan op-id (el
   *  etiquetador salta `head`, `title`, `meta`, `link`, `script` y `style`). */
  op_id: string | null;
  /** El texto alrededor de lo encontrado, con los espacios colapsados. Es un
   *  EXTRACTO para reconocer el sitio, no el HTML del elemento: quien quiera
   *  editarlo tiene que abrirlo con `leer_estado op_id=`. */
  fragmento: string;
  /** Presente cuando casó dentro de un atributo (`href`, `alt`…) y no en el
   *  texto visible. Es la diferencia entre «el enlace apunta ahí» y «el enlace
   *  se llama así». */
  atributo?: string;
}

export interface ResultadoBusqueda {
  coincidencias: Coincidencia[];
  /** Cuántas se dejaron fuera por el tope. `0` = están todas. */
  omitidas: number;
}

/**
 * Los atributos que se miran, y sólo estos.
 *
 * `href` y `src` porque el caso que motivó la herramienta era de enlaces. Los
 * demás porque son texto que el usuario LEE (o que le leen): el `alt` de una
 * foto, el `placeholder` de un campo, el `aria-label` de un botón sin rótulo.
 *
 * `class`, `style` e `id` NO están a propósito: casan por accidente
 * —«azul» dentro de `bg-azul`— y no son contenido de la página.
 */
const ATRIBUTOS_MIRADOS = [
  "href",
  "src",
  "alt",
  "title",
  "placeholder",
  "value",
  "aria-label",
] as const;

/**
 * `<style>` NO se busca, y es una decisión, no un olvido.
 *
 * El CSS de la plantilla no se edita por op-id: `editar_pagina target="styles"`
 * sólo AÑADE reglas al bloque propio del Agente. Así que una coincidencia ahí
 * dentro no tiene arreglo que ofrecer, y un `#fff` casa doscientas veces.
 */
const TAGS_SIN_TEXTO_UTIL = new Set(["style", "template"]);

/** Caracteres de contexto a cada lado de lo encontrado. Suficiente para
 *  distinguir dos «Contacto» en la misma página sin mandar el párrafo entero. */
const CONTEXTO = 60;

/** Tope de coincidencias devueltas. Buscar «a» en un sitio de seis páginas
 *  devolvería miles: el tope es lo que convierte eso en una respuesta útil y
 *  un aviso, en vez de en un turno que no cabe. */
export const TOPE_COINCIDENCIAS = 30;

/** Menos de esto casa con media página y no dice nada. */
export const TEXTO_MINIMO = 2;

const SOLO_ASCII = /^[\x00-\x7F]*$/;

/**
 * Pliega un texto para comparar: minúsculas y SIN tildes, conservando UNA
 * unidad por punto de código.
 *
 * 🔴 LA CONSERVACIÓN DE LA LONGITUD ES EL PUNTO. Lo natural sería
 * `s.normalize("NFD").replace(/\p{Diacritic}/gu, "")`, pero eso CAMBIA las
 * posiciones —«é» son dos unidades en NFD y una en el original—, y las
 * posiciones son justo lo que hace falta después para recortar el fragmento del
 * texto ORIGINAL (con sus tildes puestas). Plegando punto a punto, el índice i
 * del plegado es el índice i del array de puntos de código.
 *
 * Sin tildes porque el usuario escribe «telefono» y la página dice «teléfono»:
 * una búsqueda que no encuentra eso es una búsqueda que no sirve aquí.
 */
function plegar(texto: string): { puntos: string[]; plegado: string } {
  const puntos = Array.from(texto);
  // Atajo para el caso normal: casi todo el texto de una página es ASCII, y
  // `toLowerCase` sobre ASCII conserva la longitud igual que el plegado largo.
  if (SOLO_ASCII.test(texto)) return { puntos, plegado: texto.toLowerCase() };
  const plegado = puntos
    .map((c) => {
      const base = c.normalize("NFD").charAt(0).toLowerCase().charAt(0);
      return base || c.charAt(0);
    })
    .join("");
  return { puntos, plegado };
}

function fragmentoDe(puntos: readonly string[], desde: number, largo: number): string {
  const ini = Math.max(0, desde - CONTEXTO);
  const fin = Math.min(puntos.length, desde + largo + CONTEXTO);
  const cuerpo = puntos.slice(ini, fin).join("").replace(/\s+/g, " ").trim();
  return `${ini > 0 ? "…" : ""}${cuerpo}${fin < puntos.length ? "…" : ""}`;
}

/** El op-id del elemento, o el del antepasado más cercano que lleve uno.
 *
 *  Hace falta el paseo hacia arriba porque el etiquetador salta `br` y `hr`, y
 *  porque un documento puede traer marcado que no pasó por él. */
function opIdDe(el: HTMLElement | null): string | null {
  for (let n = el; n; n = n.parentNode) {
    const id = n.getAttribute?.("data-op-id");
    if (id) return id;
  }
  return null;
}

function dentroDe(el: HTMLElement | null, tag: string): boolean {
  for (let n = el; n; n = n.parentNode) {
    if (n.rawTagName?.toLowerCase() === tag) return true;
  }
  return false;
}

/**
 * LA SEGUNDA PUERTA: buscar por SELECTOR, no por texto.
 *
 * 🔴 POR QUE UNA PUERTA APARTE Y NO UN MODO DE `buscarEnDocumento`. Arriba está
 * escrito por qué la búsqueda de texto NO mira dentro de `class`: «azul» casaría
 * dentro de `bg-azul`, dentro de un comentario y dentro del `<style>`, y
 * devolvería tres sitios donde no hay nada que cambiar. Eso sigue siendo cierto
 * y no se toca. Lo que faltaba es lo OTRO: preguntar por la ESTRUCTURA —«las
 * tarjetas», «los botones del hero»—, que no es un texto y no se puede buscar
 * como si lo fuera.
 *
 * Es la pareja `grep` + `glob` de un agente de terminal: una puerta para el
 * contenido y otra para la forma. Len tenía sólo la primera, así que a la
 * pregunta «dónde están las tarjetas» sólo podía contestar abriendo secciones de
 * una en una.
 *
 * El selector lo interpreta `node-html-parser`, que NO es un navegador: soporta
 * etiqueta, `.clase`, `#id`, `[attr]`, descendencia y agrupación con comas, y no
 * soporta `:has()` ni la mayoría de pseudoclases. Un selector que no entiende
 * LANZA, y eso se devuelve como un error legible en vez de tumbar el turno.
 */
export function buscarPorSelector(
  taggedHtml: string,
  selector: string,
  opciones: { pagina: string; tope?: number },
): ResultadoBusqueda | { error: string } {
  const coincidencias: Coincidencia[] = [];
  let omitidas = 0;
  if (!selector.trim() || !taggedHtml.trim()) return { coincidencias, omitidas };
  const tope = opciones.tope ?? TOPE_COINCIDENCIAS;

  let encontrados: HTMLElement[];
  try {
    encontrados = parse(taggedHtml, { comment: false }).querySelectorAll(selector);
  } catch (e) {
    return {
      error: `selector no entendido: ${e instanceof Error ? e.message : String(e)}. Se admiten etiqueta, .clase, #id, [atributo], descendencia y comas; no :has() ni pseudoclases.`,
    };
  }

  for (const el of encontrados) {
    const tag = el.rawTagName?.toLowerCase() ?? "";
    // Mismo criterio que la busqueda de texto: `<style>` no se edita por op-id,
    // asi que devolver algo de ahi dentro seria ofrecer un arreglo que no
    // existe.
    if (TAGS_SIN_TEXTO_UTIL.has(tag)) continue;
    if (coincidencias.length >= tope) {
      omitidas += 1;
      continue;
    }
    const donde: DondeCasa = dentroDe(el, "head")
      ? "cabecera"
      : dentroDe(el, "script")
        ? "script"
        : "cuerpo";
    // El fragmento IDENTIFICA, y para un selector lo que identifica es su texto.
    // Cuando no lo tiene —una caja, una imagen— vale su propia etiqueta con sus
    // clases, que es lo unico que lo distingue de sus hermanos.
    const texto = (el.text ?? "").replace(/\s+/g, " ").trim();
    const clases = (el.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean);
    const fragmento = texto
      ? texto.slice(0, CONTEXTO * 2) + (texto.length > CONTEXTO * 2 ? "…" : "")
      : `<${tag}${clases.length ? `.${clases.join(".")}` : ""}>`;
    coincidencias.push({
      pagina: opciones.pagina,
      donde,
      op_id: donde === "cuerpo" ? opIdDe(el) : null,
      fragmento,
    });
  }

  return { coincidencias, omitidas };
}

/**
 * Busca `texto` en un documento YA ETIQUETADO con `data-op-id`.
 *
 * Recibe el documento etiquetado y no lo etiqueta aquí a propósito: el
 * etiquetador es el binding nativo, y los op-id que se devuelven tienen que ser
 * los MISMOS que usará después `editar_pagina` —o sea, los de
 * `session.taggedHtml`—, no una segunda numeración calculada por su cuenta.
 */
export function buscarEnDocumento(
  taggedHtml: string,
  texto: string,
  opciones: { pagina: string; tope?: number },
): ResultadoBusqueda {
  const aguja = plegar(texto.trim());
  const coincidencias: Coincidencia[] = [];
  let omitidas = 0;
  if (aguja.plegado.length < TEXTO_MINIMO || !taggedHtml.trim()) {
    return { coincidencias, omitidas };
  }
  const tope = opciones.tope ?? TOPE_COINCIDENCIAS;

  const documento = parse(taggedHtml, { comment: false });
  // UNA por elemento: si un párrafo dice «Madrid» tres veces, el modelo tiene
  // que ir al mismo sitio las tres. Repetirlo gastaría el tope en un solo
  // elemento y escondería las otras páginas.
  const yaVistos = new Set<string>();

  const anotar = (c: Coincidencia): void => {
    const clave = `${c.donde}|${c.op_id ?? ""}|${c.atributo ?? ""}|${c.fragmento}`;
    if (yaVistos.has(clave)) return;
    yaVistos.add(clave);
    if (coincidencias.length >= tope) {
      omitidas += 1;
      return;
    }
    coincidencias.push(c);
  };

  const buscarEn = (valor: string, hacer: (pos: number) => void): void => {
    const heno = plegar(valor);
    const pos = heno.plegado.indexOf(aguja.plegado);
    if (pos >= 0) hacer(pos);
  };

  for (const el of documento.querySelectorAll("*")) {
    const tag = el.rawTagName?.toLowerCase() ?? "";
    if (TAGS_SIN_TEXTO_UTIL.has(tag)) continue;

    const enCabecera = dentroDe(el, "head");
    const donde: DondeCasa = tag === "script" ? "script" : enCabecera ? "cabecera" : "cuerpo";
    // El `<script>` de la cabecera es script, no cabecera: se arregla con
    // target="runtime" igual que el del final del <body>.
    const opId = donde === "cuerpo" ? opIdDe(el) : null;

    // LA `<meta content>` ENTRA POR AQUÍ, no por la lista de atributos: es el
    // único caso en que el valor del atributo ES el texto de la página. Un
    // teléfono viejo ahí son llamadas perdidas en el resultado de Google.
    if (tag === "meta") {
      const contenido = el.getAttribute("content");
      const nombre = el.getAttribute("name") ?? el.getAttribute("property") ?? "meta";
      if (contenido) {
        buscarEn(contenido, (pos) => {
          const { puntos } = plegar(contenido);
          anotar({
            pagina: opciones.pagina,
            donde: "cabecera",
            op_id: null,
            fragmento: fragmentoDe(puntos, pos, aguja.puntos.length),
            atributo: `meta[${nombre}]`,
          });
        });
      }
      continue;
    }

    // Los NODOS DE TEXTO PROPIOS, no `el.text`: `el.text` incluye el de todos
    // los descendientes, así que el <body> casaría con todo y el op-id
    // devuelto sería el del contenedor en vez del párrafo concreto.
    for (const hijo of el.childNodes as Node[]) {
      if (hijo.nodeType !== NodeType.TEXT_NODE) continue;
      const crudo = hijo.text;
      if (!crudo.trim()) continue;
      buscarEn(crudo, (pos) => {
        const { puntos } = plegar(crudo);
        anotar({
          pagina: opciones.pagina,
          donde,
          op_id: opId,
          fragmento: fragmentoDe(puntos, pos, aguja.puntos.length),
        });
      });
    }

    if (donde !== "cuerpo") continue;
    for (const nombre of ATRIBUTOS_MIRADOS) {
      const valor = el.getAttribute(nombre);
      if (!valor) continue;
      buscarEn(valor, (pos) => {
        const { puntos } = plegar(valor);
        anotar({
          pagina: opciones.pagina,
          donde,
          op_id: opId,
          fragmento: fragmentoDe(puntos, pos, aguja.puntos.length),
          atributo: nombre,
        });
      });
    }
  }

  return { coincidencias, omitidas };
}
