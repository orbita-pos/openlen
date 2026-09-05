import { PUBLISH_CONTRACT } from "@/lib/design-guidance";
import { conContratoMinimo, contratoParaSuperficie } from "@/lib/publish-contract-min";
import { swapJsClauses } from "@/lib/ai/js-clause";
import { modelRuntimePromptBlock } from "@/lib/ai-stream/model-runtime";
import { modelPruebaPromptBlock } from "@/lib/ai-stream/model-prueba";
import { bloqueDeLibrerias } from "@/lib/librerias";

// Split out of route.ts (not just inlined there) because a Next.js
// `route.ts` file may ONLY export the recognized route-handler bindings
// (GET/POST/runtime/dynamic/…) — Next's generated `.next/types/app/api/**/
// route.ts` type-checks the module's exports against that whitelist, and
// `export const SYSTEM_PROMPT` from route.ts itself fails `tsc --noEmit`
// with "Property 'SYSTEM_PROMPT' is incompatible with index signature."
// Exported here (a plain, non-route module Next never touches) so las
// pruebas puedan importarlo sin arrastrar la ruta.
//
// ⚠️ ESTA CONSTANTE NO ES LO QUE LA RUTA MANDA. `route.ts` llama a
// `generateSystemMessage`, que sustituye el contrato por el mínimo y cambia
// las cláusulas del JavaScript. Una prueba que afirmaba sobre `SYSTEM_PROMPT`
// creyendo medir producción vivió aquí hasta el 2026-08-28 — pasaba en verde
// sin exigir nada. Quien quiera medir la generación mide
// `generateSystemMessage`.
export const SYSTEM_PROMPT = `You design and build complete landing pages from a short brief.

The brief is sometimes specific, often vague. Design the whole page yourself. The structure, the palette, the typography, the rhythm and what the page even contains are yours to decide — a vague brief is your cue to apply judgment, not to fall back on something safe.

ESTRUCTURA — no existe una forma por defecto.
Navegación arriba, héroe centrado, tres columnas de ventajas, testimonios, llamada final y pie es UNA forma, no LA forma: es la que sale sola cuando no se decide. Que la forma nazca del contenido. Algo que se lee quiere una columna; algo que se mira quiere una rejilla; algo que ocurre en el tiempo quiere una línea; algo que se compara quiere una tabla; algo con una sola idea puede caber en dos bloques y estar terminado.
Tres hábitos que hay que ELEGIR, no heredar: repartir el contenido en tarjetas de tres en tres, abrir siempre con el mismo héroe centrado, y añadir una sección porque parece que falta. Consérvalos cuando esta página los pida —un texto largo agradece su índice, una tienda agradece su navegación— y déjalos fuera cuando no.

Nothing below tells you what a page should look like. It is only what this publishing pipeline can carry.

${PUBLISH_CONTRACT}

NON-NEGOTIABLE CONSTRAINTS:
- Output a COMPLETE, self-contained HTML document: starts with <!doctype html>, ends with </html>.
- Include a descriptive <title> in <head> that names the product.
- Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
- Google Fonts via <link> in <head>. ANY family on Google Fonts is allowed — pick the ones this page's character calls for and load them yourself. A horror page, a children's workshop and a B2B dashboard should not be lettered the same way. Include the <link> for every family you use.
- All custom CSS inline in a <style> block in <head>. Declare the design tokens on :root using EXACTLY the vocabulary and the dark-mode selector the publish contract below states, and reference them via var() throughout — never hardcode the same color in many places. Give the dark values a hand-designed palette, not a mechanical inversion, and make every text and heading color resolve from a var() token so the whole page flips cleanly.
- NO React, NO Babel, NO JSX, NO <script type="text/babel">, NO window.X globals, NO import statements anywhere.
- NO data-slot-path= attribute anywhere — that is a reserved editor-mode marker.
- NO login / signup / "my account" / dashboard UI. Public marketing pages only.
- Inline SVG for logos / icons / illustrations. NO external image URLs. Where a photograph would go, resolve the area YOURSELF — nothing is swapped in later. The publish contract below states this in full.
- Mobile-responsive down to 360px width.

OUTPUT FORMAT — follow exactly:
Emit the complete HTML document directly, starting with <!doctype html> and ending with </html>. No preamble, no design notes, no markdown code fences — the first character of your response is <.`;

/**
 * El prompt que de verdad se envía. La palanca cambia los 20.231 caracteres de
 * `PUBLISH_CONTRACT` por los 4.957 de `PUBLISH_CONTRACT_MIN`.
 *
 * Lo que sale de aquí, MEDIDO el 2026-09-01: 17.738 → 13.316 caracteres. La
 * diferencia no son los 15.274 de las dos constantes porque `swapJsClauses`
 * corre después y, en la ruta del contrato completo, la cláusula `conductas`
 * ya se llevaba 10,7 K por su cuenta. Medir la constante no es medir el
 * prompt: aquí las dos cuentas se separan por un factor de tres.
 *
 * POR QUÉ EXISTE EL INTERRUPTOR. `PUBLISH_CONTRACT` se le presenta al modelo
 * diciendo que no habla de aspecto visual, y medido no es cierto: lleva 60
 * etiquetas de HTML de ejemplo y 43 menciones de vocabulario de página
 * (`nav`×9, `CTA`×6, `hero`×4…). La sospecha —que por eso todas las páginas
 * salen con la misma forma— NO está probada: hace falta la ablación de 48
 * briefs. El interruptor existe para poder probarla sin tocar producción.
 *
 * ⚠️ LO QUE SE PIERDE CON EL INTERRUPTOR ENCENDIDO: el contrato mínimo NO
 * enseña las nueve CONDUCTAS ni el carrusel, así que el modelo no emitirá esos
 * marcadores y esas páginas nacerán sin countdown, filtro, lightbox, copiar,
 * autoplay, tema, barra pegajosa, pestañas ni cálculo.
 *
 * QUIÉN TAPA ESE HUECO AHORA: el JavaScript libre. El modelo escribe esas
 * interacciones en JavaScript propio en vez de nombrar una receta nuestra —
 * medido el 2026-08-21, con el hueco SIN tapar salían 0 de 6 páginas
 * interactivas y con la cláusula cambiada 2 de 2. Los dos interruptores están
 * pensados para ir juntos; el mínimo a solas entrega páginas inertes.
 */
export function systemPromptFor(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  // EL MÍNIMO ES EL CAMINO — decisión de Jesús del 2026-08-20, EJECUTADA el
  // 2026-08-23. Estuvo tres días escrita con el interruptor apagado, esperando
  // «probarlo con el JavaScript encendido» mientras ese otro interruptor
  // estaba apagado. Medido entonces: empata en belleza (3 y 3 por su ojo), gana
  // en tamaño y gana en marcadores de foto (6/6 contra 19/24).
  //
  // Pasa a OPT-OUT, la misma semántica que los kill-switches de
  // `lib/publish/kill-switches.ts`: la ausencia enciende, sólo el literal "0"
  // devuelve el contrato completo. Un interruptor que hay que acordarse de
  // encender no es un camino, es una nota.
  // La palanca y su guarda viven en `lib/publish-contract-min.ts` desde el
  // 2026-09-01. Estaban aquí, y por eso las otras tres superficies —el Chat, el
  // Agente y el rediseño— mandaban el contrato entero: no es que se hubiera
  // decidido, es que nunca se les cableó.
  const { prompt, min } = conContratoMinimo(SYSTEM_PROMPT, "systemPromptFor", env);
  // La cláusula sobre JavaScript va DESPUÉS del recorte: con el contrato mínimo
  // hay que cambiar su viñeta, y con el completo su bloque. Cuál de las dos está
  // presente lo decide el mismo interruptor de arriba.
  // `conductas` SOLO con el contrato completo: el mínimo ya sustituyó
  // `PUBLISH_CONTRACT` entero, y con él se fueron el carrusel y el manual de las
  // 9 — pedir esa marca aquí haría LANZAR a `swapJsClauses`. O sea que el mínimo
  // llevaba razón desde el principio y esto sólo le da alcance al completo.
  const conClausulas = swapJsClauses(
    prompt,
    min
      ? ["contrato-min", "no-negociable"]
      : ["contrato-completo", "conductas", "no-negociable"],
  );
  // ESTA superficie es la que SÍ devuelve el documento entero y la ÚNICA en la
  // que escribir un enlace a /slug crea esa página (las subpáginas declaradas se
  // construyen). O sea que el contrato se queda tal cual: declararlo igualmente
  // es lo que impide que la forma de cada superficie se deduzca por omisión.
  const paraCrear = min
    ? contratoParaSuperficie(conClausulas, "systemPromptFor", {
        respuestaEsElDocumento: true,
        elEnlaceCreaLaPagina: true,
        // La página no existe todavía: el `<head>` —Tailwind, las fuentes, la
        // hoja de estilos, el bloque oscuro— lo escribe esta superficie entero.
        escribeElHead: true,
      })
    : conClausulas;
  // El catálogo de librerías va al FINAL y fuera del contrato. No es una regla
  // de publicación —es lo que hay disponible—, y meterlo dentro engordaría el
  // literal que el interruptor de arriba sustituye por medirse en tamaño.
  return `${paraCrear}\n\n${bloqueDeLibrerias()}`;
}

/** EL mensaje de sistema que `/api/generate` manda de verdad.
 *
 * Existe porque estaba escrito TRES veces en `route.ts` y una CUARTA, y
 * distinta, en `scripts/evals-pages.ts`: el eval mandaba `SYSTEM_PROMPT`
 * pelado. Así que medía un prompt que producción no manda — sin el contrato
 * mínimo (hay una prueba en este mismo archivo que fija que
 * `systemPromptFor({})` NO es `SYSTEM_PROMPT`), sin el bloque del JavaScript
 * del modelo y sin el de la prueba.
 *
 * Con el contrato pesando el 85% del prompt, eso no es un matiz: un marcador
 * verde autorizaba un despliegue medido sobre otra jaula que la que reciben
 * las páginas de la gente. Quien quiera medir la generación mide ESTO.
 */
export function generateSystemMessage(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return systemPromptFor(env) + modelRuntimePromptBlock() + modelPruebaPromptBlock();
}
