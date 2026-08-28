import "server-only";

// lib/style-match/character.ts — la mitad que sólo un par de ojos puede dar.
//
// `extract/` ya midió lo que el CSS declara: hex, familia tipográfica, radios.
// Lo que NINGÚN estilo calculado dice es el CARÁCTER — si la página respira o
// aprieta, si es seria o juguetona, si el peso visual está en la tipografía o
// en la imagen. Eso hay que verlo.
//
// QWEN, no Gemini (decisión de Jesús). Y tiene una consecuencia buena: Qwen
// mira la referencia APARTE y devuelve TEXTO, así que la imagen nunca entra en
// la llamada de creación. Sin imágenes adjuntas, `pageWriterUsesDeepSeek` no
// desvía el turno a Gemini y la página la sigue escribiendo DeepSeek entera.
// La visión se paga una vez, en el especialista barato.
//
// NUNCA LANZA. Devuelve `null` y el llamador sigue con la dirección medida.
// Una referencia a medias es mejor que ninguna, y la mitad cara no puede
// tumbar la mitad gratis.

import { z } from "zod";

import type { FireworksJsonClient } from "@/lib/ai/fireworks-client";
import { reasoningEffortFor } from "@/lib/generation/model-policy";

/** Nuestro presupuesto real: esto acaba dentro del bloque de dirección, que
 *  tiene su propio techo de 900 caracteres. */
export const CHARACTER_BUDGET_CHARS = 320;

/** EL TECHO DEL WIRE NO ES EL PRESUPUESTO, Y ESTO SE MIDIÓ CONTRA FIREWORKS.
 *
 *  `z.string().max(n)` viaja a la API como `maxLength: n` dentro de un
 *  `json_schema` con `strict: true`. Ahí no es una validación: es una GRAMÁTICA.
 *  El decodificador no puede emitir el carácter n+1, así que no rechaza la
 *  respuesta larga — la CORTA a mitad de palabra. Con el techo en 320, Qwen
 *  devolvió exactamente 320 caracteres terminados en "del titular,".
 *
 *  Así que el wire va holgado (el modelo termina su frase) y el recorte lo
 *  hacemos aquí, por frases completas. Quien baje este número volverá a
 *  amordazar al modelo en vez de acotarlo. */
const WIRE_MAX_CHARS = 700;

export const CharacterSchema = z.object({
  character: z.string().min(10).max(WIRE_MAX_CHARS),
});

export interface ReferenceCharacterInput {
  readonly requestId: string;
  /** JPEG en base64, sin el prefijo `data:`. Mismo formato que el crítico
   *  visual, para no tener dos maneras de mandar una imagen. */
  readonly screenshotBase64: string;
}

/**
 * Qué se le pide a Qwen, y —más importante— qué se le PROHÍBE.
 *
 * Sin la prohibición explícita, un modelo al que le enseñas una web describe la
 * web: nombra la marca, resume el copy, lista las secciones. Eso es justo lo
 * que no puede viajar al brief, porque es lo que convierte inspirarse en
 * calcar.
 */
const SYSTEM =
  "Miras la captura de una página web y describes SÓLO su carácter visual en 2 o 3 frases, en español: " +
  "cómo respira (densa o amplia), el tono (seria, juguetona, técnica, cálida), y dónde cae el peso visual " +
  "(tipografía grande, imagen a sangre, color plano, ilustración). " +
  "PROHIBIDO: nombrar la marca o el producto, citar o resumir su texto, listar sus secciones, describir su " +
  "estructura o layout, mencionar colores concretos o valores hex. Nada de eso es carácter, y no debe salir de aquí. " +
  // Qwen es un modelo de origen chino y en la primera prueba contra Fireworks
  // cambió de idioma a mitad de frase ("…del titular,以及"). Pedirlo explícito es
  // el arreglo barato; `tidyCharacter` es la red por si vuelve a pasar.
  "Escribe ÍNTEGRAMENTE en español, sin una sola palabra ni carácter de otro idioma. " +
  "No pases de 300 caracteres. Devuelve sólo el JSON pedido.";

/** Caracteres CJK y su puntuación. Un solo signo de estos significa que el
 *  modelo cambió de idioma, y lo que venga después ya no es español. */
const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;

/**
 * Deja el texto en algo que se pueda anteponer a un brief: español, dentro del
 * presupuesto, y terminado donde termina una frase — no donde se acabó el cupo.
 *
 * Devuelve `null` si no queda nada aprovechable. La dirección MEDIDA viaja
 * igual; perder el carácter es perder la mitad opinable, no la referencia.
 */
export function tidyCharacter(raw: string): string | null {
  let texto = raw.replace(/\s+/g, " ").trim();

  const fuga = texto.search(CJK);
  if (fuga >= 0) texto = texto.slice(0, fuga);

  if (texto.length > CHARACTER_BUDGET_CHARS) {
    const cortado = texto.slice(0, CHARACTER_BUDGET_CHARS);
    const fin = Math.max(cortado.lastIndexOf("."), cortado.lastIndexOf("!"), cortado.lastIndexOf("?"));
    // Si la última frase completa deja menos de la mitad del presupuesto, se
    // pierde demasiado; ahí es mejor cortar por palabra y marcarlo con puntos
    // suspensivos que devolver una sola frase suelta.
    if (fin >= CHARACTER_BUDGET_CHARS / 2) {
      texto = cortado.slice(0, fin + 1);
    } else {
      const espacio = cortado.lastIndexOf(" ");
      texto = `${espacio > 0 ? cortado.slice(0, espacio) : cortado}…`;
    }
  }

  // Un corte —de idioma o de cupo— suele dejar la frase colgando de una coma.
  texto = texto.replace(/[\s,;:—–-]+$/, "");
  return texto.length >= 10 ? texto : null;
}

export async function describeReferenceCharacter(
  input: ReferenceCharacterInput,
  deps: { readonly client: FireworksJsonClient },
): Promise<string | null> {
  try {
    const result = await deps.client.request({
      role: "visual_critic",
      reasoningEffort: reasoningEffortFor("visual_critic", "final_scoring"),
      requestId: `${input.requestId}.character`,
      maxOutputTokens: 512,
      responseSchema: CharacterSchema,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe el carácter visual de esta página." },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${input.screenshotBase64}` },
            },
          ],
        },
      ],
    });
    if (!result.ok) return null;
    return tidyCharacter(result.value.character);
  } catch {
    // Incluye el caso en que el presupuesto de la página rechaza la llamada:
    // quedarse sin crédito para el extra no puede costar la referencia entera.
    return null;
  }
}
