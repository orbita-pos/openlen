// LO QUE NO CABE EN UN CAMPO.
//
// `aprender.ts` guarda los hechos duros —WhatsApp, dirección, Instagram— porque
// tienen un consumidor de código: el `wa.me` del botón, la banda de plataformas,
// el pie que se hornea al publicar. Pero la mitad de lo que un dueño te cuenta
// no es un dato: «hacemos blackwork, no color», «nunca digas barato, di
// accesible», «el fuerte son las despedidas de soltera». Eso no tiene campo, y
// sin sitio donde ponerlo se perdía en cuanto acababa la conversación.
//
// Jesús, 2026-08-27: «así lo hace Claude, lo hacemos». Y así lo hace: un
// documento en prosa que el modelo escribe solo mientras hablas, que se lee
// entero en cada turno, y que el dueño puede abrir y corregir. No un formulario
// con veinte casillas más.
//
// POR QUÉ NO ES LA MEMORIA DE LA PERSONA. Son tres memorias y tres dueños:
//
//   · la PERSONA (`users.agentMemory`) — cómo quiere que le hables. Le sigue a
//     todos sus negocios: si mañana abre una cafetería, «háblame de tú» vale.
//   · el NEGOCIO (esto) — qué es y qué vende. Vale para todas las páginas de
//     ESTE negocio y para ninguna del otro.
//   · la PÁGINA (`projects.userBrief`) — lo de este proyecto y nada más.
//
// Meter lo del negocio en la memoria de la persona haría que la cafetería
// naciera sabiendo de tatuajes. Es el mismo fallo que cerró la memoria de
// usuario el 2026-08-22, con los papeles cambiados.

import {
  anadirLinea,
  quitarLinea,
  vineta,
  type DocumentoDeMemoria,
} from "@/lib/agent/documento-de-memoria";
import type { BusinessProfileData } from "./types";

/** Encabeza el bloque, en la página y en el prompt. */
export const DOC_NEGOCIO_MARCADOR = "— Sobre este negocio —";

/**
 * Tres veces la memoria de la persona (400), y con motivo: aquélla guarda
 * REGLAS —«de tú», «nada de amarillo»— que caben en una línea, y ésta guarda
 * SUSTANCIA: qué vende, a quién, con qué voz. Aun así tiene tope, porque viaja
 * en cada turno de cada página de este negocio y cada carácter se paga siempre.
 */
export const DOC_NEGOCIO_MAX = 1200;

const DOC: DocumentoDeMemoria = { marcador: DOC_NEGOCIO_MARCADOR, max: DOC_NEGOCIO_MAX };

export type ResultadoRecordar =
  | { ok: true; data: BusinessProfileData; yaExistia: boolean }
  | { ok: false; motivo: "vacio" | "largo" | "lleno" };

/** Una línea suelta, no un capítulo. Lo que no cabe aquí es o varias cosas
 *  —que van en varias líneas— o una parrafada que el modelo debería resumir
 *  antes de guardar. */
export const MAX_NOTA_NEGOCIO = 240;

/**
 * Añade una nota sobre el negocio. PURA: devuelve el perfil nuevo, no toca la
 * base — igual que `aprenderDelNegocio`, y por lo mismo: qué se escribe se
 * decide y se prueba aparte de dónde se guarda.
 */
export function recordarDelNegocio(
  data: BusinessProfileData,
  nota: string,
): ResultadoRecordar {
  // Se aplastan los saltos: el bloque es por líneas, así que un "\n• " dentro
  // del texto inyectaría viñetas falsas que luego se leen como reales.
  const limpio = nota.trim().replace(/\s*\n+\s*/g, " ");
  if (!limpio) return { ok: false, motivo: "vacio" };
  if (limpio.length > MAX_NOTA_NEGOCIO) return { ok: false, motivo: "largo" };

  const r = anadirLinea(data.memoria, limpio, DOC);
  if (!r.ok) return { ok: false, motivo: "lleno" };
  if (r.yaExistia) return { ok: true, data, yaExistia: true };
  // Copia, nunca muta: el perfil puede venir de una caché que otro lector ya
  // tiene en la mano.
  return { ok: true, data: { ...data, memoria: r.texto }, yaExistia: false };
}

/** Quita una nota. El borrado es del dueño, no del modelo: sin él, el día que
 *  se guarde algo mal el usuario se lo queda puesto en todas sus páginas. */
export function olvidarDelNegocio(
  data: BusinessProfileData,
  nota: string,
): { quitada: boolean; data: BusinessProfileData } {
  const r = quitarLinea(data.memoria, nota.trim(), DOC);
  if (!r.quitada) return { quitada: false, data };
  return { quitada: true, data: { ...data, memoria: r.texto } };
}

/** El documento como lo lee el modelo, o `null` si no hay nada que decir.
 *  Sin las viñetas ni el encabezado: el bloque `<business>` pone los suyos. */
export function lineasDelNegocio(data: BusinessProfileData): string[] {
  return (data.memoria ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("• "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
}

/**
 * El camino de vuelta: las líneas que el dueño dejó en pantalla, otra vez en
 * documento.
 *
 * EXISTE PARA QUE «MI NEGOCIO» EDITE LÍNEAS, NO TEXTO CRUDO. Enseñarle el
 * almacén —encabezado, viñetas— convertiría un fallo de tecleo en un documento
 * ilegible para el modelo, y le pediría al dueño que respete un formato que
 * nadie le explicó. Aquí él ve frases; el formato lo pone esto.
 *
 * Se recortan y se tiran las vacías: un renglón en blanco en pantalla es que
 * alguien borró el texto y no le dio a la papelera, no una nota sin contenido.
 */
export function documentoDesdeLineas(lineas: readonly string[]): string | null {
  const limpias = lineas
    .map((l) => l.trim().replace(/\s*\n+\s*/g, " ").slice(0, MAX_NOTA_NEGOCIO))
    .filter(Boolean);
  if (limpias.length === 0) return null;
  // `vineta` es la MISMA que usa `anadirLinea`: dos sitios decidiendo cuál es
  // el carácter darían un documento donde la mitad de las notas no se leen.
  return [DOC_NEGOCIO_MARCADOR, ...limpias.map((l) => vineta(l))].join("\n");
}
