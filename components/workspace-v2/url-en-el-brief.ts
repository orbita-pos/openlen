// LA URL SE ESCRIBE, NO SE ADJUNTA.
//
// El «hazme una como ésta» vivía tras un botón de cadena: lo pulsabas, se abría
// un campo, pegabas la dirección, la traías, y sólo entonces escribías tu brief.
// Cuatro gestos y un widget que hay que descubrir.
//
// Jesús, 2026-08-27: «quita eso de un input para poner el url, que sea más tipo
// v0, que le ponga el url en el chat». Tiene razón, y no es sólo comodidad: una
// dirección dentro de una frase —«hazme una como https://linear.app pero para un
// estudio de tatuajes»— dice ADEMÁS para qué la quieres. El campo aparte perdía
// esa mitad.
//
// Este módulo es sólo la lectura: encuentra la primera dirección de lo que el
// usuario escribió. Traerla, enseñarla y dejar quitarla siguen siendo del
// compositor, y siguen siendo dos gestos — el segundo, generar, sigue siendo
// suyo.

import { normalizeReferenceUrl } from "./reference-input";

/**
 * Una dirección dentro de un texto.
 *
 * Se exige el esquema. `normalizeReferenceUrl` acepta `linear.app` a secas
 * —correcto cuando el usuario está en un campo QUE PIDE una dirección— pero
 * aquí el texto es una frase: «una tienda tipo mercado libre para mi negocio»
 * tiene tres palabras con punto que no son URLs, y adivinar convertiría una
 * frase normal en una petición de red.
 *
 * Se paran en el primer carácter que no puede ir en una URL de verdad, y se
 * recorta la puntuación final: «mira https://linear.app.» no incluye el punto.
 */
const URL_EN_TEXTO = /https?:\/\/[^\s<>"'`]+/gi;
const PUNTUACION_FINAL = /[.,;:!?)\]}]+$/;

export interface UrlEncontrada {
  /** La dirección, normalizada — la que se le manda al servidor. */
  readonly url: string;
  /** Tal y como el usuario la escribió, para poder señalarla en su texto. */
  readonly crudo: string;
}

/**
 * La PRIMERA dirección utilizable del texto, o `null`.
 *
 * Sólo la primera a propósito: una referencia visual es UNA dirección. Con dos,
 * mezclar sus paletas daría una tercera que no es ninguna de las dos, y elegir
 * en silencio es peor que no elegir. Si el usuario pega dos, se usa la que
 * escribió antes y se puede quitar.
 */
export function urlEnElBrief(texto: string): UrlEncontrada | null {
  if (!texto) return null;
  URL_EN_TEXTO.lastIndex = 0;
  for (const m of texto.matchAll(URL_EN_TEXTO)) {
    const crudo = m[0].replace(PUNTUACION_FINAL, "");
    const url = normalizeReferenceUrl(crudo);
    if (url) return { url, crudo };
  }
  return null;
}
