// P4 — modo rediseño: el agente por fin tiene un camino para "rediséñala
// completa / hazla más moderna / cámbiale todo el estilo".
//
// Hasta ahora el prompt lo prohibía ("Extiende, no reemplaces — nunca
// reescrituras totales en F1", un límite de fase 1 que se quedó) y
// editar_pagina topa en 8 ops — un rediseño real pedido por el usuario
// terminaba en un tema nuevo y dos retoques. Esto es UNA llamada grande que
// reescribe el documento entero bajo la misma guía de diseño con la que las
// páginas nacen, y el resultado pasa por el MISMO embudo de persistencia que
// toda edición (sanitize → normalize → ensurePageMeta → snapshot con Undo) y
// por los ojos (verifyTurn) antes de cerrar el turno.
//
// Lo que un rediseño JAMÁS puede perder (va duro en el prompt y el caller lo
// verifica donde se puede):
//   - Elementos con atributos data-ol-* (bandas de módulos, conductas, datos
//     vivos) — son cableado del producto, no decoración.
//   - Los HECHOS: textos con datos reales (nombre, contacto, precios) y URLs
//     reales (href / img src) — puede REORGANIZARLOS, nunca inventar nuevos.
//   - El idioma de la página.

import type { StreamEvent } from "@/lib/ai-gateway";
import { streamWithRetry } from "@/lib/agent/retry";
import {
  fireworksStreamProvider,
  type FlexibleStreamRequest,
} from "@/lib/ai/fireworks-as-stream-provider";
import { modelRuntimePromptBlock } from "@/lib/ai-stream/model-runtime";
import { swapJsClauses } from "@/lib/ai/js-clause";
import { PUBLISH_CONTRACT } from "@/lib/design-guidance";
import { conContratoMinimo, contratoParaSuperficie } from "@/lib/publish-contract-min";
import { bloqueDeLibrerias } from "@/lib/librerias";

export interface RedesignInput {
  /** Autoridad ya calculada por la ruta/sesión para el documento activo. */
  /** El documento ACTIVO actual (sin data-op-id — el crudo persistido). */
  html: string;
  /** La dirección creativa, en palabras del usuario ("más moderna y oscura"). */
  direccion: string;
  /** El brief persistente del proyecto, si existe. */
  brief: string | null;
  /** El JavaScript que la página YA tiene, ya verificado contra su cápsula.
   *
   *  `html` viene SANEADO —sin scripts— porque así se persiste. Sin esto el
   *  rediseño no puede conservar ni reparar una conducta que no ve, y la
   *  re-inventa desde cero. */
  runtime?: string | null;
}

export type RedesignOutcome =
  | {
      ok: true;
      html: string;
      usage: { inputTokens: number; outputTokens: number; cachedTokens: number };
    }
  | { ok: false; error: string };

/** La superficie mínima del proveedor que el rediseño necesita. Con nombre
 *  propio para que el adaptador de Fireworks pueda declararla. */
export interface RedesignProviderLike {
  stream(
    request: FlexibleStreamRequest,
    opts: { signal?: AbortSignal },
  ): AsyncIterableIterator<StreamEvent>;
}

export interface RedesignInternals {
  provider?: RedesignProviderLike;
  /** Se cobra al dueño por tokens medidos — inyectado por realDeps. */
  debit?: (credits: number) => Promise<void>;
  timeoutMs?: number;
}

// El mismo techo de salida que el Mode B de ai-design (65_536): un documento
// de página completa ronda 10-25k tokens; 16k truncaría los grandes.
const MAX_OUTPUT_TOKENS = 65_536;
const TEMPERATURE = 0.8;
// Un rediseño es UNA llamada larga — más generoso que un turno normal, pero
// acotado: pasado esto, el usuario lleva minutos mirando un spinner.
const DEFAULT_TIMEOUT_MS = 150_000;
// Un documento rediseñado que salga diminuto casi siempre es un doc a medias
// (fence cortado, respuesta truncada) — mejor rechazar que persistir un muñón.
const MIN_OUTPUT_CHARS = 2_000;

/**
 * Las cláusulas que el rediseño voltea. EXPORTADA a propósito: la prueba de
 * superficies (`lib/ai/js-clause-superficies.test.ts`) monta este prompt igual
 * que la ruta, y si la lista viviera sólo aquí dentro esa prueba tendría que
 * copiarla — que es cómo una prueba acaba comprobando su propia copia en vez
 * del código. Una lista, un sitio.
 */
export const REDESIGN_JS_CLAUSES = ["rediseno", "contrato-completo", "conductas"] as const;

/**
 * EL PROMPT QUE LA RUTA MANDA DE VERDAD — contrato recortado y cláusulas ya
 * cambiadas.
 *
 * 🔴 POR QUÉ EXISTE ESTA FUNCIÓN Y NO SÓLO LA CONSTANTE. Es la misma lección
 * que ya está escrita en las otras tres superficies: mientras la única puerta
 * de entrada sea el literal, cualquiera que mida esto —una prueba, un eval, o
 * yo— mide otra jaula que la que reciben las páginas de la gente. Aquí el
 * ensamblado eran DOS pasos en el `route`, y la prueba de superficies tenía que
 * repetirlos a mano para no medir de menos.
 *
 * 🔴 Y AQUÍ SE INTERPOLABA `DESIGN_GUIDANCE` ENTERA — 32.487 caracteres. Era la
 * única superficie que seguía mandando la guía completa: el esqueleto de
 * secciones, el orden, la barra de diseño, los ejemplos. O sea justo el «gusto
 * nuestro» que `lib/prompts-superficies.test.ts` vigila que no salga… en una
 * lista de tres superficies donde el rediseño no estaba. Ahora manda contrato,
 * como las demás, y con la misma palanca.
 *
 * MEDIDO sobre lo que sale de aquí, con el mismo documento de entrada:
 * 27.198 → 10.509 caracteres, −61%. Es el recorte más grande de las cuatro,
 * porque es la única que además soltaba la guía entera.
 */
export function redesignPromptFinal(
  input: RedesignInput,
  env?: Readonly<Record<string, string | undefined>>,
): string {
  const { prompt, min } = conContratoMinimo(
    buildRedesignPrompt(input),
    "redesignPromptFinal",
    env,
  );
  const conClausulas = swapJsClauses(
    prompt,
    // `conductas` sólo con el completo: el mínimo ya se llevó el manual de las
    // 9, y pedir esa marca sobre un texto que no la tiene LANZA.
    min ? ["rediseno", "contrato-min"] : REDESIGN_JS_CLAUSES,
  );
  if (!min) return conClausulas;
  return contratoParaSuperficie(conClausulas, "redesignPromptFinal", {
    // El rediseño SÍ devuelve el documento entero: esa frase del contrato es
    // verdad aquí y se queda.
    respuestaEsElDocumento: true,
    // Pero reescribe UN documento. Escribir `href="/servicios"` no crea esa
    // página, y la ruta inexistente sirve la portada con un 200: el contrato
    // enseñaba aquí el enlace roto silencioso.
    elEnlaceCreaLaPagina: false,
  });
}

export function buildRedesignPrompt(input: RedesignInput): string {
  // ⚰️ Aquí se le pegaban al prompt los DATOS REALES DEL NEGOCIO sacados del
  // perfil, con la orden de no inventarlos. Se fue con el perfil el 2026-08-31,
  // y no deja hueco: lo que impide que un rediseño pierda el teléfono o la
  // foto del dueño es `lib/agent/facts-kept.ts`, que los COMPRUEBA en el
  // resultado — no una frase en mayúsculas pidiéndoselo al modelo.
  const briefBlock = input.brief?.trim()
    ? `\nBRIEF PERSISTENTE DEL PROYECTO:\n${input.brief.trim()}\n`
    : "";
  // El JavaScript que la página ya tiene. Va DESPUÉS del documento, donde el
  // modelo ya sabe qué marcado está mirando.

  return `Rediseña por completo esta landing page siguiendo la dirección del dueño. Emites UN documento HTML completo (<!doctype html> ... </html>) y NADA más — sin markdown, sin fences, sin comentarios fuera del documento.

DIRECCIÓN DEL DUEÑO: ${input.direccion}
${briefBlock}
REGLAS DURAS DEL REDISEÑO:
1. CONSERVA todo elemento que lleve un atributo data-ol-* (la banda data-ol-collection-section y sus tarjetas data-ol-item / data-ol-item-field, marcadores de conducta, spans data-ol-live). Puedes moverlos de sección, rehacer su maquetación y re-estilizarlos por completo, pero el elemento y sus atributos data-ol-* sobreviven INTACTOS: son lo que al publicar se rellena con los datos reales del dueño. Si rediseñas las tarjetas del catálogo, todas siguen siendo hermanas y con la misma estructura.
2. CONSERVA los hechos: nombres, textos con datos concretos (precios, horarios, direcciones, teléfonos) y TODA URL real (href e img src) que exista en el documento actual. Reorganízalos y reescribe el copy alrededor, pero no inventes datos ni URLs nuevas — las únicas imágenes permitidas son las que ya están en el documento.
3. CONSERVA el idioma del documento actual.
4. CONSERVA el <title> y los <meta> del <head> actual (puedes reordenarlos).
5. NADA de JavaScript propio: ni <script> tuyos, ni atributos on*, ni <iframe> — se borran al guardar y los botones quedarían muertos. ÚNICA excepción: <script src="https://cdn.tailwindcss.com"> (el runtime de Tailwind, permitido). La interactividad sale de CSS puro o de los marcadores de conducta ya presentes.
6. NUNCA emitas data-slot-path ni data-op-id.
7. El documento nuevo es COMPLETO y autosuficiente (Tailwind por CDN está bien), responsive, y bello al nivel de la guía de abajo.

DOCUMENTO ACTUAL:
${input.html}

LO QUE LA PUBLICACIÓN IMPONE:
${PUBLISH_CONTRACT}

${bloqueDeLibrerias()}

Emite ahora el documento HTML completo rediseñado.`;
}

/** Extrae el documento de la respuesta del modelo: quita fences si los puso y
 *  recorta al rango <!doctype ... </html>. null si no hay documento completo. */
export function extractRedesignedDocument(raw: string): string | null {
  let s = raw
    .trim()
    .replace(/^\s*```(?:html)?\s*\n?/i, "")
    .replace(/\n?\s*```\s*$/i, "")
    .trim();
  const start = s.search(/<!doctype\s+html/i);
  const startHtml = start === -1 ? s.search(/<html[\s>]/i) : start;
  if (startHtml === -1) return null;
  const end = s.toLowerCase().lastIndexOf("</html>");
  if (end === -1) return null;
  s = s.slice(startHtml, end + "</html>".length);
  if (s.length < MIN_OUTPUT_CHARS) return null;
  return s;
}

/** Rediseña el documento. Nunca lanza — devuelve ok:false con un motivo
 *  accionable; el documento original queda intacto en cualquier fallo.
 *
 *  Se llamaba `redesignWithGemini`, y ese nombre costo un bug real: quien
 *  escribio el llamador leyo «WithGemini» y exigio `GEMINI_API_KEY`, asi que
 *  quitar esa clave apagaba `redisenar_pagina` entero sin que Gemini pintara
 *  una linea. Escribe DeepSeek desde el 2026-08-26, y desde el 2026-08-28 no
 *  hay otra opcion — el nombre viejo ya no puede volver a enganar a nadie. */
export async function redesignPage(
  input: RedesignInput,
  internals: RedesignInternals = {},
): Promise<RedesignOutcome> {
  const timeoutMs = internals.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Race contra el deadline (mismo esqueleto que verify.ts): el abort corta el
  // stream real, y el race garantiza que un provider que lo ignore tampoco
  // pueda colgar el turno.
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve("timeout");
    }, timeoutMs);
  });

  try {
    const result = await Promise.race<RedesignOutcome | "timeout">([
      runRedesign(input, internals, abort.signal),
      timeoutPromise,
    ]);
    if (result === "timeout") {
      return { ok: false, error: "el rediseño tardó demasiado — inténtalo de nuevo" };
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    abort.abort();
  }
}

/**
 * QUIÉN REESCRIBE. DeepSeek, por el mismo transporte que el resto del texto:
 * un rediseño es escribir una página, no mirar una imagen.
 *
 * ⚠️ Y ABRE UNA PUERTA: la captura del JavaScript del modelo exige que lo haya
 * escrito DeepSeek (`RUNTIME_CAPSULE_VERSION` es "deepseek-generate-v1"), así
 * que con este cambio el rediseño del Agente PUEDE capturar. Cablearlo es un
 * paso aparte, no automático.
 */
function defaultRedesignProvider(): RedesignProviderLike {
  // Sin `jsonObject`: aquí la salida es un documento HTML, no JSON.
  return fireworksStreamProvider({
    requestId: "agent-redesign",
    // Reescribir una página entera es el mismo trabajo que edita el Chat.
    operation: "page_edit",
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: TEMPERATURE,
  });
}

async function runRedesign(
  input: RedesignInput,
  internals: RedesignInternals,
  signal: AbortSignal,
): Promise<RedesignOutcome> {
  const provider = internals.provider ?? defaultRedesignProvider();
  try {
    let raw = "";
    const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    let stopError: string | null = null;

    for await (const ev of streamWithRetry(
      () =>
        provider.stream(
          {
            messages: [{
              role: "user",
              // La cláusula sólo voltea donde HAY captura: el rediseño produce un
              // documento entero, `editar_pagina` emite ops y no puede llevarla.
              // UNA sola puerta: `redesignPromptFinal` hace el recorte del
              // contrato Y el cambio de cláusulas. Aquí eran dos pasos sueltos,
              // y la prueba de superficies tenía que repetirlos a mano.
              content: redesignPromptFinal(input) + modelRuntimePromptBlock(),
            }],
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            temperature: TEMPERATURE,
          },
          { signal },
        ),
      { signal },
    )) {
      if (ev.type === "text_delta") raw += ev.text;
      else if (ev.type === "usage") {
        usage.inputTokens += ev.inputTokens;
        usage.outputTokens += ev.outputTokens;
        usage.cachedTokens += ev.cachedTokens;
      } else if (ev.type === "done" && ev.stopReason.kind === "error") {
        stopError = ev.stopReason.error;
      } else if (ev.type === "done" && ev.stopReason.kind === "max_tokens") {
        stopError = "la respuesta se truncó (documento demasiado grande)";
      }
    }

    if (stopError) return { ok: false, error: `el modelo falló: ${stopError.slice(0, 160)}` };

    const html = extractRedesignedDocument(raw);
    if (!html) {
      return { ok: false, error: "el modelo no devolvió un documento HTML completo" };
    }

    // Se cobra por tokens medidos — el patrón de editar_imagen: la herramienta
    // cara cobra lo suyo, el loop lo demás.
    //
    // 🔴 LA TARIFA SIGUE A QUIEN CORRE. Esto cobraba a "gemini-flash" mientras
    // el rediseno ya corria por Fireworks; hoy solo puede correr uno, asi que
    // la tarifa deja de ser una pregunta.
    if (internals.debit) {
      const { creditsForUsage } = await import("@/lib/credits");
      const tarifa = "deepseek-pro" as const;
      const credits = Math.max(
        1,
        creditsForUsage(usage.inputTokens, usage.outputTokens, tarifa, usage.cachedTokens),
      );
      await internals.debit(credits).catch(() => {});
    }

    // EL SCRIPT DEL MODELO. Se lee del CRUDO: para cuando existe el documento
    // extraído, el saneado de la publicación ya lo habría borrado.
    //
    // ⚰️ AQUI SE CAPTURABA el `<script>` del modelo del texto CRUDO, «antes de
    // que el saneado lo borrara». Retirado el 2026-09-04, y las dos mitades de
    // esa frase eran falsas:
    //
    //   · La captura NO PODIA SALIR. `extractModelRuntime` cuenta cualquier
    //     <script>, y un documento rediseñado lleva SIEMPRE el de Tailwind por
    //     CDN que el contrato exige: con el del modelo son dos, y devuelve
    //     «varios». Su prueba pasaba porque el fixture no traia el de Tailwind.
    //   · Y el saneado NO LO BORRA. Este motor pasa por `gateReservedMarker`,
    //     que solo mira `data-slot-path`. El <script> viaja DENTRO del
    //     documento y se guarda con el, comprobado de punta a punta.
    //
    // O sea que `modelRuntime` era null siempre y el `runtimeIntent` caia a
    // `preservar`, que es un no-op. Retirarlo no cambia un byte de lo guardado.
    return { ok: true, html, usage };
  } catch (err) {
    return {
      ok: false,
      error: `rediseño falló: ${String((err as { message?: unknown })?.message ?? err).slice(0, 160)}`,
    };
  }
}
