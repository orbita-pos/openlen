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

import { GeminiProvider, type StreamEvent, type StreamRequest } from "@/lib/ai-gateway";
import { streamWithRetry } from "@/lib/agent/retry";
import { DESIGN_GUIDANCE } from "@/lib/design-guidance";

export interface RedesignInput {
  /** El documento ACTIVO actual (sin data-op-id — el crudo persistido). */
  html: string;
  /** La dirección creativa, en palabras del usuario ("más moderna y oscura"). */
  direccion: string;
  /** El bloque negocio del ESTADO (JSON compacto) o null. */
  negocio: Record<string, unknown> | null;
  /** El brief persistente del proyecto, si existe. */
  brief: string | null;
}

export type RedesignOutcome =
  | { ok: true; html: string; usage: { inputTokens: number; outputTokens: number; cachedTokens: number } }
  | { ok: false; error: string };

export interface RedesignInternals {
  provider?: {
    stream(
      request: StreamRequest,
      opts: { signal?: AbortSignal },
    ): AsyncIterableIterator<StreamEvent>;
  };
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

export function buildRedesignPrompt(input: RedesignInput): string {
  const negocioBlock = input.negocio
    ? `\nDATOS REALES DEL NEGOCIO (úsalos tal cual — jamás los inventes ni los cambies):\n${JSON.stringify(input.negocio, null, 1)}\n`
    : "";
  const briefBlock = input.brief?.trim()
    ? `\nBRIEF PERSISTENTE DEL PROYECTO:\n${input.brief.trim()}\n`
    : "";

  return `Rediseña por completo esta landing page siguiendo la dirección del dueño. Emites UN documento HTML completo (<!doctype html> ... </html>) y NADA más — sin markdown, sin fences, sin comentarios fuera del documento.

DIRECCIÓN DEL DUEÑO: ${input.direccion}
${negocioBlock}${briefBlock}
REGLAS DURAS DEL REDISEÑO:
1. CONSERVA todo elemento que lleve un atributo data-ol-* (bandas de módulos como data-ol-bookings-section / data-ol-collection-section / data-ol-comments-section, marcadores de conducta, spans data-ol-live). Puedes moverlos de sección y re-estilizar su envoltorio, pero el elemento y sus atributos data-ol-* sobreviven INTACTOS.
2. CONSERVA los hechos: nombres, textos con datos concretos (precios, horarios, direcciones, teléfonos) y TODA URL real (href e img src) que exista en el documento actual. Reorganízalos y reescribe el copy alrededor, pero no inventes datos ni URLs nuevas — las únicas imágenes permitidas son las que ya están en el documento.
3. CONSERVA el idioma del documento actual.
4. CONSERVA el <title> y los <meta> del <head> actual (puedes reordenarlos).
5. NADA de JavaScript propio: ni <script> tuyos, ni atributos on*, ni <iframe> — se borran al guardar y los botones quedarían muertos. ÚNICA excepción: <script src="https://cdn.tailwindcss.com"> (el runtime de Tailwind, permitido). La interactividad sale de CSS puro o de los marcadores de conducta ya presentes.
6. NUNCA emitas data-slot-path ni data-op-id.
7. El documento nuevo es COMPLETO y autosuficiente (Tailwind por CDN está bien), responsive, y bello al nivel de la guía de abajo.

DOCUMENTO ACTUAL:
${input.html}

GUÍA DE DISEÑO (tu estándar de calidad):
${DESIGN_GUIDANCE}

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

/** Rediseña el documento con Gemini. Nunca lanza — devuelve ok:false con un
 *  motivo accionable; el documento original queda intacto en cualquier fallo. */
export async function redesignWithGemini(
  input: RedesignInput,
  model: string,
  apiKey: string,
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
      runRedesign(input, model, apiKey, internals, abort.signal),
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

async function runRedesign(
  input: RedesignInput,
  model: string,
  apiKey: string,
  internals: RedesignInternals,
  signal: AbortSignal,
): Promise<RedesignOutcome> {
  const provider = internals.provider ?? new GeminiProvider(apiKey);
  try {
    let raw = "";
    const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    let stopError: string | null = null;

    for await (const ev of streamWithRetry(
      () =>
        provider.stream(
          {
            model,
            messages: [{ role: "user", content: buildRedesignPrompt(input) }],
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

    // Se cobra por tokens medidos (misma tarifa flash del loop) — el patrón de
    // editar_imagen: la herramienta cara cobra lo suyo, el loop lo demás.
    if (internals.debit) {
      const { creditsForUsage } = await import("@/lib/credits");
      const credits = Math.max(1, creditsForUsage(usage.inputTokens, usage.outputTokens, "gemini-flash"));
      await internals.debit(credits).catch(() => {});
    }

    return { ok: true, html, usage };
  } catch (err) {
    return {
      ok: false,
      error: `rediseño falló: ${String((err as { message?: unknown })?.message ?? err).slice(0, 160)}`,
    };
  }
}
