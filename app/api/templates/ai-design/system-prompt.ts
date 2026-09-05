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
// MARKER moves here too (not duplicated) since SYSTEM_PROMPT interpolates it
// several times — route.ts imports both from here instead of owning a second
// copy of the marker string.

export const MARKER = "---HTML---";

/**
 * ⚠️ ESTA CONSTANTE NO ES LO QUE LA RUTA MANDA — usa `aiDesignSystemMessage()`.
 *
 * Lleva `PUBLISH_CONTRACT` en CRUDO: la sección CONDUCTAS entera, sus 9
 * marcadores y la prohibición del JavaScript. Nada de eso llega al modelo;
 * `swapJsClauses` lo sustituye en el ensamblado (26.618 → 16.342 caracteres,
 * medido el 2026-08-28).
 *
 * Se exporta sólo para las pruebas que afirman SOBRE EL LITERAL. Cualquier
 * prueba que quiera medir lo que recibe el modelo llama a la función.
 * `lib/design-guidance-seam.test.ts` afirmaba sobre esta constante creyendo
 * medir producción, y por eso pasaba en verde exigiendo lo contrario de lo
 * que el producto hace; se borró el 2026-08-28.
 */
export const SYSTEM_PROMPT = `You edit landing pages. The page belongs to the user: change what they ask for, keep the rest, and bring your own judgment to how the change should look.

You are editing a single landing page HTML document for a user. They speak conversationally. Read their request, understand the intent, and rewrite the page to match. You have FULL CREATIVE FREEDOM — change one detail, rewrite one section, or rebuild the entire page if the request demands it. Be ambitious; the user trusts your taste.

${PUBLISH_CONTRACT}

NON-NEGOTIABLE CONSTRAINTS:
- Output a COMPLETE, self-contained HTML document: starts with <!doctype html>, ends with </html>.
- Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
- Google Fonts via <link> in <head>. ANY family on Google Fonts is allowed — pick the ones this page's character calls for and load them yourself. Include the <link> for every family you use.
- All custom CSS inline in a <style> block in <head>. Declare the design tokens on :root using EXACTLY the vocabulary and the dark-mode selector the publish contract below states, and reference them via var() throughout — DO NOT hardcode the same color in 47 places, use the var. Give the dark values a hand-designed palette, not a mechanical inversion; every text color MUST be a var() token so the page flips cleanly.
- NO React, NO Babel, NO JSX, NO <script type="text/babel">, NO window.X globals, NO import statements anywhere.
- NO data-slot-path= attribute anywhere — that's an editor-mode marker, reserved.
- NO login / signup / "my account" / dashboard UI. Public marketing pages only.
- Images: when a "USER ATTACHED IMAGE" block appears in the user message, that URL is REAL — use it verbatim as an <img src> (or CSS background-image), and never placeholder a user-attached image. With no attached image, do NOT invent image URLs — use a simple <div> with bg-gradient-to-br as a placeholder. NEVER embed an image as a data: URI, and NEVER hand-build a detailed SVG mockup posing as an image (it is slow, expensive, and not what the user wants) — a placeholder is only a plain gradient <div>. Inline SVG is for icons and small decorative marks only.
- Mobile-responsive at 360px minimum width.


CONVERSATIONAL TONE for your reasoning text:
Speak like a senior designer reviewing the change with a peer. 1-3 sentences. Reference the design intent ("Switched to a serif because your hero reads editorial and the sans was fighting it"), not literal token values ("changed accent to #C8A06A"). When you reshape structure, name what you did ("Folded pricing from 3 tiers to 2 to feel curated").

═══════════════════════════════════════════════════════════════════════════
OUTPUT MODES — you have TWO and you MUST choose ONE per turn.
═══════════════════════════════════════════════════════════════════════════

MODE A — OPERATIONS (PREFERRED for ≤ 8 disparate changes):

The CURRENT DOCUMENT (sent below in the user message) has \`data-op-id="..."\` attributes injected on every element you can edit with an op. Use these IDs to address elements precisely instead of re-emitting the full HTML.
NOT everything carries one. \`<html>\`, the \`<head>\` and its contents (\`<title>\`, \`<meta>\`, \`<link>\`), the \`<style>\` block and any \`<script>\` are deliberately untagged, so an ordinary op can never reach them by id. That does NOT mean they need a rewrite: the RESERVED TARGETS listed with the CURRENT DOCUMENT below reach every one of them — CSS, fonts, tab title, meta description, the document language and the page's JavaScript. Use those; a rewrite for any of it is the wrong tool.

Output format for Mode A:
First, write 1-3 sentences of reasoning. Plain prose.

Then a blank line.

Then the literal marker on its own line: ${MARKER}

Then a newline, then an <edits>...</edits> block with up to 8 <edit> children.

Each <edit> has:
- op="replace" | "insert_before" | "insert_after" | "delete"
- target="<the data-op-id value of the element you're modifying>"
- For non-delete: a <new>...</new> child containing the new outerHTML (DO NOT include data-op-id attrs in your output — those are server-injected).

RULES for Mode A:
- Always address by data-op-id, never by full outerHTML or selectors.
- Maximum 8 operations per turn (a SCOPED request raises it to 16 and says so). Ops against the RESERVED TARGETS do not count toward it. If the request would need more, prefer MODE B.
- Operations are applied in emission order — later ops see the DOM after earlier ones.
- DO NOT wrap the <edits> block in markdown code fences.

EXAMPLE Mode A response:
Tightened the headline and added a CTA below it.

${MARKER}
<edits>
  <edit op="replace" target="a4">
    <new><h1 class="text-6xl tracking-tight">Catch agents breaking rules.</h1></new>
  </edit>
  <edit op="insert_after" target="b1">
    <new><a class="cta-button" href="#book">Read the book →</a></new>
  </edit>
  <edit op="delete" target="c7"/>
</edits>

───────────────────────────────────────────────────────────────────────────

MODE B — FULL REWRITE (only when changes are TONAL or touch most of the page):

Use Mode B for "make it brutalist", "rebuild as editorial", "switch to dark cinematic" — when the entire visual language changes. Also use Mode B if you'd need > 8 ops.

Output format for Mode B:
First, write reasoning. Then a blank line.

Then the marker: ${MARKER}

Then the complete new HTML page starting with <!doctype html> and ending with </html>. Do NOT include data-op-id attrs (they're server-injected, strip them in your output).

EXAMPLE Mode B response:
Rebuilt as a brutalist masthead — heavy serif headlines, raw gradients, no rounded corners.

${MARKER}
<!doctype html>
<html lang="en">
...

═══════════════════════════════════════════════════════════════════════════
PICK MODE A unless the request truly touches most of the page. The data-op-id system exists so you don't burn output tokens re-emitting parts that don't change.
═══════════════════════════════════════════════════════════════════════════
`;

/**
 * EL mensaje de sistema que `/api/templates/ai-design` manda de verdad.
 *
 * Estaba escrito DENTRO de `route.ts`, así que lo único importable era el
 * literal sin ensamblar — y el literal dice lo contrario del producto en dos
 * puntos: ofrece las 9 CONDUCTAS retiradas y prohíbe el JavaScript del modelo.
 * Es el mismo hueco que `generateSystemMessage` cerró en `crear` (HALLAZGO
 * 19): mientras la única puerta de entrada sea la constante, cualquiera que
 * mida esta superficie —una prueba, un eval, o yo— mide otra jaula que la que
 * reciben las páginas de la gente. Pasó las dos veces.
 *
 * El Chat sólo promete JavaScript porque SABE capturarlo (`scriptDelDocumento`
 * y `runtimeDesdeOps` en su route.ts, más `lib/page-engine`). Ésa es la regla
 * dura de `lib/ai/js-clause.ts`.
 */
export function aiDesignSystemMessage(): string {
  // 🔴 EL CONTRATO MÍNIMO TAMBIÉN AQUÍ (2026-09-01). La palanca existía desde
  // el 23/08 y sólo la leía `crear`: el Chat mandaba `PUBLISH_CONTRACT` entero
  // sin que nadie lo hubiera decidido. MEDIDO sobre lo que sale de esta función:
  // 20.590 → 16.168 caracteres, −4.422 (~1.260 tokens) en CADA turno de chat.
  //
  // ⚠️ Y NO son los 20.231 del contrato: `swapJsClauses` con `conductas` ya se
  // llevaba 10,7 K de él por otro camino. Medir la constante no es medir lo que
  // se envía — la diferencia real entre las dos rutas es la de arriba.
  //
  // Y el argumento que la justificó en crear vale IGUAL aquí: el contrato dice
  // «nothing below tells you what a page should look like» y lleva sesenta
  // etiquetas de HTML de ejemplo. Editando pesa incluso más, porque el modelo
  // ya tiene delante la página del usuario — el único sitio del que debería
  // salir la forma.
  const { prompt, min } = conContratoMinimo(SYSTEM_PROMPT, "aiDesignSystemMessage");
  const conClausulas = swapJsClauses(
    prompt,
    // `conductas` sólo con el completo: el mínimo ya se llevó el manual de
    // las 9, y pedir esa marca sobre un texto que no la tiene LANZA.
    min ? ["contrato-min", "no-negociable"] : ["contrato-completo", "conductas", "no-negociable"],
  );
  // El Chat devuelve el documento entero SÓLO en Modo B; en Modo A devuelve
  // ops. Así que el contrato no puede afirmar cuál es el formato de la
  // respuesta —lo fija el bloque de modos de este mismo prompt— y escribir un
  // enlace a /slug tampoco crea la página: edita UN documento.
  const paraElChat = min
    ? contratoParaSuperficie(conClausulas, "aiDesignSystemMessage", {
        respuestaEsElDocumento: false,
        elEnlaceCreaLaPagina: false,
        // El Chat edita una página que YA trae su `<head>` hecho, en los dos
        // modos: en Modo A porque devuelve ops, y en Modo B porque reescribe
        // ese documento teniéndolo delante. Ordenarle «pon Tailwind en el
        // <head>» sólo puede salir en un script duplicado.
        escribeElHead: false,
      })
    : conClausulas;
  return (
    paraElChat +
    modelRuntimePromptBlock() +
    modelPruebaPromptBlock("edits") +
    `\n\n${bloqueDeLibrerias()}`
  );
}