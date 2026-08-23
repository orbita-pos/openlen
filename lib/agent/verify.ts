// Los ojos del agente — verificación visual post-edición (Agente F5).
//
// Tras un turno que MUTÓ el documento, el loop (via el hook verifyTurn del
// route) renderiza la página editada, se la muestra a Gemini Flash y pregunta
// una sola cosa: ¿la edición dejó rotura visual OBJETIVA? No es el crítico de
// belleza de /api/generate (esa página nace nuestra); esta página ES DEL
// USUARIO y el agente acaba de aplicar lo que pidió — juzgar el gusto sería
// pelearse con el dueño. Solo rotura: texto encimado o cortado, contraste
// ilegible, layout desbordado, sección visiblemente vacía o duplicada,
// imagen rota.
//
// Todo es BEST-EFFORT y fail-open, igual que lib/ai/vision-critique.ts: sin
// Chrome, sin key, timeout, JSON malformado → veredicto "ok" con fallback=true
// y el turno cierra como siempre. La verificación solo puede mejorar un turno
// o dejarlo igual — nunca bloquearlo.

import { GeminiProvider, type InlineImage, type StreamEvent, type StreamRequest } from "@/lib/ai-gateway";
import { renderHtmlToInlineImage } from "@/lib/ai/inline-image";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { injectModelRuntime } from "@/lib/ai-stream/model-runtime";
import {
  avisoSpec,
  leerFallos,
  specProgram,
  type FalloSpec,
  type PasoSpec,
} from "@/lib/agent/behavior-spec";
import { streamWithRetry } from "@/lib/agent/retry";
import { fireworksStreamProvider } from "@/lib/ai/fireworks-as-stream-provider";

export interface VisualVerdict {
  /** true = la edición dejó rotura visual objetiva. */
  broken: boolean;
  /** Problemas concretos, en el idioma del prompt del usuario cuando se puede. */
  issues: string[];
  /** true cuando esto es el fallback (render/API/parse/timeout falló) — el
   *  caller lo trata como "no hay nada que arreglar". */
  fallback: boolean;
  /** Tokens de la llamada de visión — para contabilidad (el eval runner los
   *  suma a su costo real). Ausente en fallbacks que nunca llamaron al modelo. */
  usage?: { inputTokens: number; outputTokens: number; cachedTokens: number };
}

export interface VerifyParams {
  /** El documento YA editado (el último updatedHtml del turno). */
  html: string;
  /** El JavaScript del modelo, verificado contra su cápsula.
   *
   *  `html` viene SANEADO —así se persiste— así que sin esto los ojos miran una
   *  página sin scripts y jamás verían reventar el código que el propio modelo
   *  escribió. Se inyecta igual que al publicar: un `<script>` clásico antes de
   *  `</body>`. Ausente ⇒ se renderiza exactamente como antes. */
  runtime?: string | null;
  /** El pedido original del usuario este turno — contexto de intención. */
  userPrompt: string;
  /** LO QUE EL MODELO PROMETIÓ que su código haría, si lo declaró.
   *
   *  Sin esto los ojos sólo responden «¿explotó?». Una ruleta que gira y no
   *  para nunca carga limpia, sale perfecta en la foto y no lanza un error —
   *  y está rota. Ausente ⇒ se pulsa a ciegas como hasta ahora. */
  spec?: readonly PasoSpec[] | null;
  /** Model id Gemini, e.g. "gemini-3.5-flash". */
  model: string;
  apiKey?: string;
}

export interface VerifyProviderLike {
  stream(
    request: StreamRequest,
    opts: { signal?: AbortSignal },
  ): AsyncIterableIterator<StreamEvent>;
}

export interface VerifyInternals {
  provider?: VerifyProviderLike;
  render?: (html: string) => Promise<InlineImage | null>;
  /** El medidor DETERMINISTA de contraste. Se inyecta aparte del render de la
   *  foto porque son dos navegadores distintos y sólo uno sabe medir. */
  medir?: (html: string) => Promise<{ unreadableText?: readonly { contrast: number }[] } | null>;
  /** Override del deadline — solo tests. */
  timeoutMs?: number;
}

// La verificación corre DESPUÉS de que el texto del turno ya streameó — cada
// segundo aquí es espera visible ("Revisando el resultado…"), así que el
// presupuesto es corto: render ~2-4s + Flash vision con salida chica, con
// margen para que streamWithRetry cabalgue un pico 503 (observado en vivo:
// el primer intento 503 y el segundo/tercero pasan). Vencido el plazo,
// fail-open.
export const VERIFY_TIMEOUT_MS = 20_000;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 600;
const VERIFY_MAX_OUTPUT_TOKENS = 2_048; // Flash gasta thinking antes del primer token — generoso para no truncar el JSON (mismo racional que vision-critique)
const VERIFY_TEMPERATURE = 0.1;
// Más de esto no es un arreglo quirúrgico sino una re-crítica de toda la
// página — se recortan las primeras N.
const MAX_ISSUES = 4;

const VERDICT_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    broken: { type: "BOOLEAN" },
    issues: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["broken", "issues"],
  propertyOrdering: ["broken", "issues"],
};

function fallbackVerdict(): VisualVerdict {
  return { broken: false, issues: [], fallback: true };
}

/**
 * Quién mira. Qwen es el papel con visión de la política —al razonador nunca se
 * le manda una imagen— y llega por el mismo transporte de streaming que el
 * resto, así que `verifyEditedPage` no cambia una línea de su cuerpo.
 *
 * No se le impone un esquema al modelo: el modo estricto de Fireworks rechaza
 * esquemas válidos (medido), y `parseVisualVerdict` ya tolera vallas de
 * markdown, texto alrededor y campos de más. Se pide un objeto JSON y se valida
 * aquí, que es donde siempre se validó.
 *
 * `OPENLEN_AGENT_EYES=gemini` devuelve los ojos de antes. Y como todo en este
 * archivo, cualquier fallo cae al veredicto de reserva: la verificación sólo
 * puede mejorar un turno, jamás bloquearlo.
 */
function defaultVerifyProvider(): VerifyProviderLike {
  const apiKey = process.env.GEMINI_API_KEY;
  if (process.env.OPENLEN_AGENT_EYES?.trim().toLowerCase() === "gemini") {
    return new GeminiProvider(apiKey as string);
  }
  return fireworksStreamProvider({
    requestId: "agent-verify",
    operation: "agent_visual_verify",
    maxOutputTokens: 2_048,
    jsonObject: true,
  });
}

/** Verifica visualmente la página editada. Siempre resuelve — nunca lanza;
 *  cualquier fallo devuelve el fallback (broken=false). */
export async function verifyEditedPage(
  params: VerifyParams,
  internals: VerifyInternals = {},
): Promise<VisualVerdict> {
  const timeoutMs = internals.timeoutMs ?? VERIFY_TIMEOUT_MS;
  const deadline = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      deadline.abort();
      resolve("timeout");
    }, timeoutMs);
  });

  try {
    const result = await Promise.race<VisualVerdict | "timeout">([
      runVerify(params, internals, deadline.signal).catch((err) => {
        logFallback(`error: ${err instanceof Error ? err.message : String(err)}`);
        return fallbackVerdict();
      }),
      timeoutPromise,
    ]);
    if (result === "timeout") {
      logFallback(`timeout (>${timeoutMs}ms)`);
      return fallbackVerdict();
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    deadline.abort();
  }
}

// Mapa de contenido: el texto que el HTML DICE tener, para cruzarlo contra lo
// que la captura MUESTRA. Sin esto el crítico es ciego al peor fallo posible:
// texto invisible (blanco sobre blanco) no se ve "roto" en un screenshot — se
// ve como nada. Verificado en vivo: sin el mapa, una página con el H1
// invisible y una lista de precios ilegible pasó como sana.
export function contentMap(html: string): string {
  const bodyAt = html.search(/<body[^>]*>/i);
  const body = bodyAt === -1 ? html : html.slice(bodyAt);
  const stripped = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const out: string[] = [];
  const re = /<(h1|h2|h3|p|li|a|button|figcaption|blockquote)\b[^>]*>([^<]{4,})</gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null && out.length < 30) {
    const text = m[2].replace(/\s+/g, " ").trim();
    if (text.length >= 4) out.push(`<${m[1].toLowerCase()}> ${text.slice(0, 90)}`);
  }
  return out.length ? out.join("\n") : "(no text content found)";
}

async function runVerify(
  params: VerifyParams,
  internals: VerifyInternals,
  signal: AbortSignal,
): Promise<VisualVerdict> {
  const render = internals.render ?? renderHtmlToInlineImage;
  // EL MISMO injerto que hace el publicador, no uno parecido: si los ojos miran
  // un documento armado de otra forma, miran una página que nadie recibe. Aquí
  // NO se persiste nada — es una vista de usar y tirar dentro del navegador.
  const codigo = params.runtime?.trim();
  const paraRenderizar = codigo ? injectModelRuntime(params.html, codigo) : params.html;
  // El medidor de contraste corre EN PARALELO con la foto: son dos navegadores
  // y encadenarlos gastaría ~2s del presupuesto de 20 para nada. Fail-open como
  // el resto — si no hay medidor o revienta, se sigue exactamente igual.
  //
  // Sólo cuando el llamador inyectó un `render` propio se toma también su
  // `medir`: un doble de prueba que sustituye el navegador de la foto no puede
  // acabar arrancando Chrome de verdad por la puerta de al lado. Con los dos
  // por omisión (producción), corre el medidor real.
  const medir =
    internals.medir ?? (internals.render ? async () => null : renderVisualQualityViewports);
  const medicion = medir(paraRenderizar).catch(() => null);

  const gritos: string[] = [];
  let fallosSpec: FalloSpec[] = [];
  // Si el modelo declaró qué debe pasar, se comprueba ESO. Si no, se pulsa a
  // ciegas: sigue viendo el script que muere al primer clic, que es lo que
  // había antes de que existiera el guion.
  const conGuion = codigo && params.spec && params.spec.length > 0;
  const image = await render(paraRenderizar, {
    onErrors: (e) => gritos.push(...e),
    ...(conGuion
      ? {
          behaviorProgram: specProgram(params.spec!),
          onBehaviorResult: (b) => { fallosSpec = leerFallos(b); },
        }
      : codigo
        ? { pressButtons: true }
        : {}),
  });
  if (!image) {
    logFallback("render failed — no screenshot");
    return fallbackVerdict();
  }
  const contrastes = (await medicion)?.unreadableText ?? [];
  if (signal.aborted) return fallbackVerdict();

  const apiKey = params.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logFallback("GEMINI_API_KEY missing");
    return fallbackVerdict();
  }

  const provider: VerifyProviderLike = internals.provider ?? defaultVerifyProvider();

  let raw = "";
  const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  // streamWithRetry: los picos 503 de Gemini son transitorios y el resto del
  // agente ya los cabalga — sin esto, cada pico convierte la verificación en
  // fallback (observado en vivo el 2026-07-28).
  for await (const ev of streamWithRetry(
    () =>
      provider.stream(
        {
          model: params.model,
          messages: [
            { role: "user", content: buildVerifyPrompt(params.userPrompt, params.html) },
          ],
          images: [image],
          responseMimeType: "application/json",
          responseSchema: VERDICT_SCHEMA,
          maxOutputTokens: VERIFY_MAX_OUTPUT_TOKENS,
          temperature: VERIFY_TEMPERATURE,
        },
        { signal },
      ),
    { attempts: RETRY_ATTEMPTS, baseMs: RETRY_BASE_MS, signal },
  )) {
    if (ev.type === "text_delta") {
      raw += ev.text;
    } else if (ev.type === "usage") {
      usage.inputTokens += ev.inputTokens;
      usage.outputTokens += ev.outputTokens;
      usage.cachedTokens += ev.cachedTokens;
    } else if (ev.type === "done" && ev.stopReason.kind === "error") {
      logFallback(`gemini error: ${ev.stopReason.error}`);
      return fallbackVerdict();
    }
  }

  const verdict = parseVisualVerdict(raw);
  if (!verdict) {
    logFallback("malformed JSON verdict");
    return fallbackVerdict();
  }
  // LO QUE EL NAVEGADOR GRITÓ. No pasa por el juicio del crítico visual: una
  // excepción es un HECHO, y encima de los que el ojo no puede ver — la captura
  // de una página cuyo JavaScript murió sale idéntica a la de una sana. MEDIDO
  // el 2026-08-22 con tres páginas cuya foto pesaba exactamente lo mismo: una
  // sana, una que revienta al cargar y una que revienta al pulsar.
  //
  // Cuando hubo runtime, además se PULSARON sus controles (dos rondas), así que
  // esto cubre las tres formas de estar muerto: al cargar, al primer clic y a
  // la segunda jugada. Por eso la frase no dice «al cargar» — diría una cosa
  // que a veces es falsa, y el modelo buscaría el bug en el sitio equivocado.
  //
  // Va primero en la lista: es lo más accionable de todo lo que el turno puede
  // decirle al modelo.
  if (gritos.length > 0) {
    verdict.issues = [
      ...gritos.map((g) => `El JavaScript de la página falla (al cargarla o al usar sus controles): ${g}`),
      ...verdict.issues,
    ];
    verdict.broken = true;
  }
  // TEXTO QUE NADIE PUEDE LEER, medido en el render — no juzgado por el ojo del
  // crítico, que es malo justo en esto: un botón amarillo con letras blancas se
  // ve «bonito» en una captura y es ilegible.
  //
  // MEDIDO el 2026-08-22: pidiéndole «pon el botón en #f5e050 con el texto en
  // blanco» el Agente obedece al pie de la letra y entrega 1.34:1 — el usuario
  // pidió los colores, así que `cambiar_tema` (que camina el contraste hasta
  // cumplir WCAG) ni entra en juego. Por el camino determinista el peor caso de
  // 12 fue 4.88:1; escribiendo el CSS a mano, la mitad quedó por debajo de 4.5.
  //
  // El detector ya existía y ya lo cazaba con el número exacto: sólo no llegaba
  // al Agente. Es fail-open como todo lo demás — sin medidor, sin cambios.
  // LA PROMESA DEL MODELO, ejecutada. Va ANTES que todo lo demás en la lista:
  // un contraste flojo es un defecto; una página que no hace lo que el usuario
  // pidió no es la página que pidió.
  //
  // Esto es lo que separa escribir código de entregarlo. Hasta aquí los ojos
  // sabían si la página explotaba; ahora saben si CUMPLE.
  if (fallosSpec.length > 0) {
    verdict.issues = [avisoSpec(fallosSpec), ...verdict.issues];
    verdict.broken = true;
  }
  if (contrastes.length > 0) {
    const peor = Math.min(...contrastes.map((c) => c.contrast));
    verdict.issues = [
      `${contrastes.length} texto(s) que el navegador pinta y nadie puede leer — el peor a ${peor.toFixed(2)}:1 de contraste (el mínimo legible es 3:1). Arregla el color del texto o el del fondo con editar_pagina; si el usuario pidió ESOS colores exactos, dile que así no se lee y propón el ajuste mínimo que sí cumple.`,
      ...verdict.issues,
    ];
    verdict.broken = true;
  }
  verdict.usage = usage;
  // eslint-disable-next-line no-console
  console.log(
    `[agent-verify] broken=${verdict.broken} issues=${JSON.stringify(verdict.issues.join("; "))}`,
  );
  return verdict;
}

function buildVerifyPrompt(userPrompt: string, html: string): string {
  return `<role>You are the visual safety check for a page-editing agent. The attached screenshot is the user's OWN landing page, taken right after the agent applied an edit the user asked for.</role>
<user-request>${userPrompt}</user-request>
<content-map>
The page's HTML contains this text content. Cross-check it against the screenshot — content listed here that is NOT visible in the image usually means invisible text (same color as its background), the worst kind of breakage because the owner won't notice it either:
${contentMap(html)}
</content-map>
<task>Decide ONE thing: did the page end up with OBJECTIVE visual breakage? You are NOT a taste critic — the owner chose this design and the agent did what they asked. Never flag style, density, color taste, copy quality, or anything a reasonable owner could have wanted on purpose.</task>
<flag-only>
- Content from the content-map that is NOT visible anywhere in the screenshot (invisible text).
- Text overlapping other text or images, or clipped mid-word by its container.
- Text barely readable against its background (very low contrast).
- Layout breakage: elements escaping their container, horizontal overflow, a section collapsed to a sliver.
- A large visibly EMPTY region (blank hole with no content) or the same section visibly duplicated back-to-back.
- A broken image (missing-image icon / empty frame where an image clearly belongs).
</flag-only>
<output>Strict JSON per the schema: broken=true ONLY if at least one flag-only problem is clearly present; issues lists each problem in one short sentence, in the SAME LANGUAGE as the user request above, naming WHERE on the page it is (e.g. "en el hero", "en la sección de precios"). broken=false with issues=[] when the page looks coherent. When in doubt, broken=false.</output>`;
}

/** Parse + valida el veredicto. null → fallback (lo mapea el caller). */
export function parseVisualVerdict(raw: string): VisualVerdict | null {
  const text = raw
    .trim()
    .replace(/^\s*```(?:json)?\s*\n?/i, "")
    .replace(/\n?\s*```\s*$/i, "")
    .trim();
  if (!text) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      obj = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.broken !== "boolean") return null;

  const issues = (Array.isArray(o.issues) ? o.issues : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .slice(0, MAX_ISSUES);

  // broken sin un solo problema nombrado no es accionable — no dispara nada.
  return { broken: o.broken && issues.length > 0, issues, fallback: false };
}

function logFallback(reason: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[agent-verify] fallback (${reason}) — sin verificación este turno`);
}
