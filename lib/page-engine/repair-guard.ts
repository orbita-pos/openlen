// Una reparación tiene que arreglar la página, no vaciarla.
//
// EL FALLO QUE ESTO CIERRA, medido el 2026-08-24 en un proyecto real. La
// puerta que aceptaba una reparación tenía UN solo criterio:
//
//     if (defectosTras.length < paraReparar.length)   // aceptada
//
// Y el defecto que se estaba reparando era éste:
//
//     el selector `.hover-zoom .card-img` no aplica NUNCA: falta class=
//
// La forma más barata de hacer desaparecer la queja de un selector muerto es
// BORRAR EL MARCADO. La puerta premiaba exactamente eso. Resultado: 11 ops,
// «3 → 1 defectos», y una tienda entera sin un solo <h1>, con los siete
// envoltorios de animación vacíos y el título del hero desaparecido. El
// sistema hizo lo que se le pidió; lo que estaba mal era lo que se le pidió.
//
// No es un fallo de la reparación. Es una métrica que sube mientras la página
// muere, porque nadie le dijo nunca que conservar el texto también contaba.
//
// SIN EXPRESIONES REGULARES COMPLICADAS NI PARSER. Este guardián corre en la
// ruta de creación, que es de las más calientes, y su trabajo es comparar dos
// documentos — no entenderlos. Compara el texto normalizado que realmente se
// conserva y cuenta encabezados/elementos; medir sólo la longitud permitiría
// sustituir toda la copia por otra de igual tamaño.

/** Bloques cuyo contenido NO es texto que el visitante lee. */
const NO_VISIBLES = new Set(["script", "style", "template", "noscript"]);
const TEXTO_CRUDO = new Set(["script", "style"]);
const VACIOS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);

type TokenHtml =
  | { readonly tipo: "texto"; readonly valor: string }
  | { readonly tipo: "comentario" }
  | { readonly tipo: "etiqueta"; readonly nombre: string | null; readonly cierre: boolean; readonly autocierre: boolean };

/** Escáner pequeño de HTML: `>` entre comillas sigue dentro del atributo. */
function escanearHtml(html: string): TokenHtml[] {
  const tokens: TokenHtml[] = [];
  let inicioTexto = 0;
  let i = 0;
  while (i < html.length) {
    if (html[i] !== "<") {
      i += 1;
      continue;
    }
    if (inicioTexto < i) tokens.push({ tipo: "texto", valor: html.slice(inicioTexto, i) });
    if (html.startsWith("<!--", i)) {
      const finComentario = html.indexOf("-->", i + 4);
      i = finComentario === -1 ? html.length : finComentario + 3;
      tokens.push({ tipo: "comentario" });
      inicioTexto = i;
      continue;
    }
    let quote: "'" | '"' | null = null;
    let fin = i + 1;
    for (; fin < html.length; fin += 1) {
      const caracter = html[fin];
      if (quote) {
        if (caracter === quote) quote = null;
      } else if (caracter === "'" || caracter === '"') {
        quote = caracter;
      } else if (caracter === ">") {
        break;
      }
    }
    if (fin === html.length) {
      tokens.push({ tipo: "texto", valor: html.slice(i) });
      return tokens;
    }
    const bruto = html.slice(i, fin + 1);
    const nombre = /^<\s*\/?\s*([a-z][\w:-]*)/i.exec(bruto)?.[1]?.toLowerCase() ?? null;
    tokens.push({
      tipo: "etiqueta",
      nombre,
      cierre: /^<\s*\//.test(bruto),
      autocierre: /\/\s*>$/.test(bruto),
    });
    i = fin + 1;
    inicioTexto = i;
    // script y style son raw-text: un literal como "<template>" dentro de
    // JavaScript no abre una etiqueta. El primer cierre HTML real gana incluso
    // dentro de una cadena, igual que en el parser del navegador.
    if (nombre && TEXTO_CRUDO.has(nombre) && !/^<\s*\//.test(bruto) && !/\/\s*>$/.test(bruto)) {
      const cierreCrudo = new RegExp(`<\\/\\s*${nombre}\\s*>`, "i");
      const resto = html.slice(i);
      const encontrado = cierreCrudo.exec(resto);
      if (!encontrado || encontrado.index === undefined) return tokens;
      i += encontrado.index;
      inicioTexto = i;
    }
  }
  if (inicioTexto < html.length) tokens.push({ tipo: "texto", valor: html.slice(inicioTexto) });
  return tokens;
}

/**
 * El texto que un visitante leería, aproximado a propósito.
 *
 * No distingue `display:none` ni nada que dependa de CSS: para eso haría falta
 * un navegador, y esto tiene que costar microsegundos. Lo que mide es si el
 * documento SIGUE TENIENDO SUS PALABRAS, que es la pregunta que importa.
 */
export function textoVisible(html: string): string {
  let profundidadNoVisible = 0;
  return escanearHtml(html)
    .flatMap((token) => {
      if (token.tipo === "comentario") return [];
      if (token.tipo === "etiqueta") {
        if (token.nombre && NO_VISIBLES.has(token.nombre)) {
          profundidadNoVisible += token.cierre ? -1 : 1;
        }
        return [];
      }
      return profundidadNoVisible === 0 ? [token.valor] : [];
    })
    // No inventar separadores entre nodos: insertar o quitar un <span> no
    // cambia el textContent que ve el navegador y tampoco debe parecer una
    // edición de copia. El whitespace real del documento sí se conserva.
    .join("")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contarEncabezados(html: string): number {
  let profundidadNoVisible = 0;
  let total = 0;
  for (const token of escanearHtml(html)) {
    if (token.tipo !== "etiqueta") continue;
    if (token.nombre && NO_VISIBLES.has(token.nombre)) {
      profundidadNoVisible += token.cierre ? -1 : 1;
      continue;
    }
    if (
      profundidadNoVisible === 0 &&
      !token.cierre &&
      token.nombre !== null &&
      /^h[1-6]$/.test(token.nombre)
    ) total += 1;
  }
  return total;
}

/**
 * Cuenta cada elemento cuyo subárbol conserva texto que el visitante puede
 * leer. Es deliberadamente un recorrido ligero de tokens, no un DOM: la ruta
 * sólo necesita detectar que una reparación vació nodos existentes.
 */
export function contarElementosConTextoVisible(html: string): number {
  const pila: {
    tag: string;
    tieneTexto: boolean;
    anteriorMismaEtiqueta: number | null;
  }[] = [];
  const ultimaApertura = new Map<string, number>();
  let total = 0;
  let profundidadNoVisible = 0;

  // Cada marco se desapila una sola vez. Además de propagar el bit de texto al
  // padre, el enlace por nombre evita buscar linealmente una etiqueta de cierre
  // dentro de toda la pila (incluso con HTML hostil o mal anidado).
  const cerrarHasta = (indice: number) => {
    while (pila.length > indice) {
      const marco = pila.pop();
      if (!marco) break;
      if (marco.tieneTexto) {
        total += 1;
        const padre = pila.at(-1);
        if (padre) padre.tieneTexto = true;
      }
      if (marco.anteriorMismaEtiqueta === null) {
        ultimaApertura.delete(marco.tag);
      } else {
        ultimaApertura.set(marco.tag, marco.anteriorMismaEtiqueta);
      }
    }
  };

  for (const token of escanearHtml(html)) {
    if (token.tipo === "comentario") continue;
    if (token.tipo === "etiqueta") {
      if (token.nombre && NO_VISIBLES.has(token.nombre)) {
        profundidadNoVisible += token.cierre ? -1 : 1;
        continue;
      }
      if (profundidadNoVisible > 0 || token.nombre === null) continue;
      if (token.cierre) {
        const indice = ultimaApertura.get(token.nombre);
        if (indice !== undefined) cerrarHasta(indice);
        continue;
      }
      if (VACIOS.has(token.nombre) || token.autocierre) continue;
      const indice = pila.length;
      pila.push({
        tag: token.nombre,
        tieneTexto: false,
        anteriorMismaEtiqueta: ultimaApertura.get(token.nombre) ?? null,
      });
      ultimaApertura.set(token.nombre, indice);
      continue;
    }

    if (profundidadNoVisible > 0 || token.valor.replace(/&nbsp;/gi, " ").trim().length === 0) continue;
    const actual = pila.at(-1);
    if (actual) actual.tieneTexto = true;
  }

  cerrarHasta(0);
  return total;
}

/**
 * Cuánto texto puede perder una reparación y seguir siendo una reparación.
 *
 * Es una operación QUIRÚRGICA —ops sobre nodos concretos, no una reescritura—,
 * así que en la práctica el texto no debería moverse casi nada. El 10 % es
 * holgura, no permiso: por debajo de eso ya no está arreglando, está borrando.
 */
export const UMBRAL_TEXTO = 0.9;

// La ruta normal (una reparación que sólo toca marcado o añade texto) sale por
// los fast paths lineales. El LCS exacto queda para textos realmente editados;
// por encima de este tamaño se rechaza si no podemos demostrar conservación
// linealmente. Una reparación es opcional: ante duda, conservar el original es
// más seguro que pagar CPU cuadrática o aceptar una reescritura.
const MAX_TEXTO_PARA_LCS = 20_000;

function esSubsecuencia(texto: string, dentroDe: string): boolean {
  let cursor = 0;
  for (let i = 0; i < dentroDe.length && cursor < texto.length; i += 1) {
    if (dentroDe.charCodeAt(i) === texto.charCodeAt(cursor)) cursor += 1;
  }
  return cursor === texto.length;
}

/**
 * LCS exacto con el algoritmo bit-parallel de Allison–Dix.
 *
 * Cada bit representa una unidad UTF-16 del texto original. BigInt ejecuta
 * las operaciones por palabras nativas y evita la matriz O(n·m) en memoria.
 */
function longitudSubsecuenciaComun(antes: string, despues: string): number {
  const mascaras = new Map<number, bigint>();
  let bit = 1n;
  for (let i = 0; i < antes.length; i += 1) {
    const unidad = antes.charCodeAt(i);
    mascaras.set(unidad, (mascaras.get(unidad) ?? 0n) | bit);
    bit <<= 1n;
  }

  let estado = 0n;
  for (let i = 0; i < despues.length; i += 1) {
    const coincidencias = mascaras.get(despues.charCodeAt(i)) ?? 0n;
    const candidatas = coincidencias | estado;
    estado = candidatas & ~(candidatas - ((estado << 1n) | 1n));
  }

  const bitsPorHex = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
  let total = 0;
  for (const digito of estado.toString(16)) {
    total += bitsPorHex[Number.parseInt(digito, 16)] ?? 0;
  }
  return total;
}

function medirTextoExactoConservado(
  antes: string,
  despues: string,
): number | null {
  if (antes === despues || esSubsecuencia(antes, despues)) return antes.length;
  if (esSubsecuencia(despues, antes)) return despues.length;
  if (
    antes.length > MAX_TEXTO_PARA_LCS ||
    despues.length > MAX_TEXTO_PARA_LCS
  ) {
    return null;
  }
  return longitudSubsecuenciaComun(antes, despues);
}

export type VeredictoReparacion =
  | { readonly ok: true }
  | { readonly ok: false; readonly motivo: string };

/**
 * ¿La reparación conservó la página?
 *
 * Crecer siempre vale: una reparación que AÑADE un texto que faltaba es una
 * reparación buena. Lo que se rechaza es encoger.
 */
export function reparacionConservaContenido(
  antes: string,
  despues: string,
): VeredictoReparacion {
  const textoAntes = textoVisible(antes);
  const textoDespues = textoVisible(despues);

  // Multiplicar por 10 evita que un redondeo permita 8/10 caracteres: el
  // límite es 90% exacto, no el entero inferior de ese porcentaje.
  if (
    textoAntes.length > 0 &&
    textoDespues.length * 10 < textoAntes.length * 9
  ) {
    const pct = Math.round(
      (1 - textoDespues.length / textoAntes.length) * 100,
    );
    return {
      ok: false,
      motivo: `perdió el ${pct}% del texto (${textoAntes.length} → ${textoDespues.length} caracteres)`,
    };
  }

  if (textoAntes.length > 0) {
    const conservado = medirTextoExactoConservado(textoAntes, textoDespues);
    if (conservado === null) {
      return {
        ok: false,
        motivo: `no pudo verificar el texto exacto de una reparación extensa (${textoAntes.length} → ${textoDespues.length} caracteres)`,
      };
    }
    if (conservado * 10 < textoAntes.length * 9) {
      const pct = Math.round((conservado / textoAntes.length) * 100);
      return {
        ok: false,
        motivo: `conservó sólo el ${pct}% del texto exacto (${conservado}/${textoAntes.length} caracteres)`,
      };
    }
  }

  // Un encabezado menos NUNCA es un arreglo. Es la firma exacta del caso que
  // originó este guardián: la tienda pasó de tener títulos a no tener ninguno.
  const hAntes = contarEncabezados(antes);
  const hDespues = contarEncabezados(despues);
  if (hDespues < hAntes) {
    return {
      ok: false,
      motivo: `perdió encabezados (${hAntes} → ${hDespues})`,
    };
  }

  const elementosAntes = contarElementosConTextoVisible(antes);
  const elementosDespues = contarElementosConTextoVisible(despues);
  if (elementosDespues < elementosAntes) {
    return {
      ok: false,
      motivo: `perdió elementos con texto (${elementosAntes} → ${elementosDespues})`,
    };
  }

  return { ok: true };
}

export interface CandidataReparacion {
  readonly htmlAntes: string;
  readonly htmlDespues: string;
  readonly motorValido: boolean;
  readonly defectosAntes: number;
  readonly defectosDespues: number;
}

/** La única puerta de aceptación de la reparación usada por /api/generate. */
export function aceptarReparacion(candidata: CandidataReparacion): VeredictoReparacion {
  if (!candidata.motorValido) return { ok: false, motivo: "el motor rechazó la reparación" };
  if (candidata.defectosDespues >= candidata.defectosAntes) {
    return { ok: false, motivo: "no bajó el número de defectos" };
  }
  return reparacionConservaContenido(candidata.htmlAntes, candidata.htmlDespues);
}
