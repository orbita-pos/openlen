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
import { streamWithRetry } from "@/lib/agent/retry";

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
  /** El pedido original del usuario este turno — contexto de intención. */
  userPrompt: string;
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
  const image = await render(params.html);
  if (!image) {
    logFallback("render failed — no screenshot");
    return fallbackVerdict();
  }
  if (signal.aborted) return fallbackVerdict();

  const apiKey = params.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logFallback("GEMINI_API_KEY missing");
    return fallbackVerdict();
  }

  const provider: VerifyProviderLike = internals.provider ?? new GeminiProvider(apiKey);

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
