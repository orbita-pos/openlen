// UN DOCUMENTO DE MEMORIA: viñetas bajo un encabezado, con tope y sin olvidos.
//
// Esto vivía dentro de `user-memory.ts`, atado a la única memoria que había —la
// de la PERSONA— y a su columna. Al aparecer la segunda —la del NEGOCIO— había
// dos caminos: copiar sesenta líneas o sacar el texto de la base. Se saca.
//
// Lo que queda aquí es PURO: entra un texto, sale otro. Ninguna de las dos
// memorias necesita la base para decidir si una línea ya estaba, si cabe, o
// dónde va el encabezado — y esa decisión, que es toda la sustancia, se prueba
// sin bindings nativos y en un milisegundo.
//
// LAS TRES REGLAS, que vienen de la memoria de usuario y valen igual para las
// dos (ver el encabezado de `user-memory.ts` para el porqué largo):
//
//   · TEXTO, no filas. Se lee ENTERO en cada turno; el modelo necesita las diez
//     líneas delante, no un buscador.
//   · ACOTADO. Al ir en todos los prompts, cada carácter se paga siempre. Si no
//     cabe, es que se está guardando lo que no se debe.
//   · LLENO NO BORRA. Al llegar al tope se rechaza lo NUEVO y se avisa; jamás se
//     tira una línea vieja para hacer sitio. Olvidar en silencio algo que el
//     usuario pidió recordar es peor que no recordar lo último.

/** La forma de un documento: su encabezado y cuánto cabe. */
export interface DocumentoDeMemoria {
  /** Encabeza el bloque para que el modelo —y el dueño, cuando lo abra— sepan
   *  de dónde salió cada línea. */
  readonly marcador: string;
  /** Tope en caracteres del documento ENTERO, encabezado incluido. */
  readonly max: number;
}

export type Anadido =
  | { readonly ok: true; readonly texto: string; readonly yaExistia: boolean }
  | { readonly ok: false; readonly motivo: "llena" };

/** Una viñeta. El prefijo es parte del formato, no del contenido: el bloque es
 *  por líneas, y sin marca una línea suelta no se distingue de la prosa que
 *  pudiera haber encima. */
export function vineta(texto: string): string {
  return `• ${texto}`;
}

/**
 * Añade una línea al documento. Idempotente por texto EXACTO.
 *
 * El de-duplicado es tonto a propósito. Detectar que «nunca uses amarillo» y
 * «el amarillo no me gusta» son la misma cosa exige un juicio, y un juicio
 * equivocado aquí o pierde algo que el usuario pidió guardar, o llena el
 * documento de repeticiones. Entre las dos, repetir se ve y se corrige.
 */
export function anadirLinea(
  actual: string | null | undefined,
  texto: string,
  doc: DocumentoDeMemoria,
): Anadido {
  const linea = vineta(texto);
  const previo = actual ?? "";
  if (previo.split("\n").some((l) => l.trim() === linea)) {
    return { ok: true, texto: previo, yaExistia: true };
  }

  // Se recorta sólo la cola: un documento que creció con `\n` al final añadiría
  // una línea en blanco por escritura, y a los diez cambios el tope se gasta en
  // huecos.
  const base = previo.replace(/\s+$/, "");
  const siguiente = base.includes(doc.marcador)
    ? `${base}\n${linea}`
    : base.length > 0
      ? // Había texto sin encabezado (escrito por otra cosa, o a mano). Se
        // respeta y el bloque se abre debajo, en vez de pisarlo.
        `${base}\n\n${doc.marcador}\n${linea}`
      : `${doc.marcador}\n${linea}`;

  if (siguiente.length > doc.max) return { ok: false, motivo: "llena" };
  return { ok: true, texto: siguiente, yaExistia: false };
}

export interface Quitado {
  readonly quitada: boolean;
  /** `null` cuando no queda nada: un encabezado sin viñetas es un documento
   *  vacío que ocupa sitio y le dice al modelo que hay algo que leer. */
  readonly texto: string | null;
}

/**
 * Quita una línea.
 *
 * Existe porque un documento al que sólo se puede AÑADIR es una trampa: el día
 * que guarde algo mal, el usuario se queda con ello puesto en todas sus páginas
 * para siempre.
 */
export function quitarLinea(
  actual: string | null | undefined,
  texto: string,
  doc: DocumentoDeMemoria,
): Quitado {
  const previo = actual ?? "";
  if (!previo) return { quitada: false, texto: null };
  const linea = vineta(texto);
  const lineas = previo.split("\n");
  const quedan = lineas.filter((l) => l.trim() !== linea);
  if (quedan.length === lineas.length) return { quitada: false, texto: previo };
  const vivas = quedan.filter((l) => l.trim() !== "" && l.trim() !== doc.marcador);
  return { quitada: true, texto: vivas.length ? quedan.join("\n").trim() : null };
}
