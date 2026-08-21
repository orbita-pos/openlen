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
import { reasoningEffortFor } from "@/lib/generation/fable-model-policy";

/** Dos o tres frases. El techo es corto a propósito: esto acaba dentro del
 *  bloque de dirección, que tiene su propio presupuesto de 900 caracteres, y un
 *  modelo al que no se le acota la prosa escribe un ensayo. */
export const CharacterSchema = z.object({
  character: z.string().min(10).max(320),
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
  "Devuelve sólo el JSON pedido.";

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
    const texto = result.value.character.trim();
    return texto.length >= 10 ? texto : null;
  } catch {
    // Incluye el caso en que el presupuesto de la página rechaza la llamada:
    // quedarse sin crédito para el extra no puede costar la referencia entera.
    return null;
  }
}
