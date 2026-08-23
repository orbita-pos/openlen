// Streaming HTML generation pipeline — wires @openlen/ai-gateway
// (GeminiProvider) into @openlen/html-engine (HtmlStream) plus the credit
// ledger (lib/credits.ts) into a single helper. This is the load-bearing
// helper that F3 S4 will use to cut over /api/generate and
// /api/templates/ai-design.
//
// Surface:
//   const { stream, done } = generateHtmlStream({
//     apiKey: process.env.GEMINI_API_KEY!,
//     messages: [{ role: "user", content: brief }],
//     userId,
//     signal: controller.signal,
//   })
//   // Pipe `stream` as the live preview; await `done` after for the
//   // canonical post-process HTML + accounting.
//
// Behaviour:
// - Streams per-write HTML chunks (sanitized + op-id-tagged) as the LLM
//   produces them. Bad HTML (data-slot-path, pipeline poisoning) errors
//   the stream synchronously; further chunks are dropped.
// - On `usage` event: debit credits via lib/credits.ts using the exact
//   token counts the provider reports. Debit failures are logged but do
//   NOT break the stream — service stays available even if the ledger is
//   down (best-effort accounting; reconciliation is a separate concern).
// - On `done` with kind=end_turn|max_tokens: call HtmlStream.end() and
//   surface the canonical post-process HTML via the `done` promise. The
//   stream itself only carries per-write chunks; consumers that need the
//   normalized output should await `done.finalHtml`.
// - On `done { kind: 'cancelled' }`: stream closes cleanly (no error
//   thrown). HtmlStream.end() is NOT called (partial document; F1 S5
//   handoff §3.1.4). `finalHtml === null`.
// - Cancellation policy: credits are debited on the `usage` event as it
//   arrives; if cancellation lands before `usage`, NO debit happens. If
//   `usage` already fired, the debit is already done and there is no
//   refund. This matches the F3 S2 handoff spec.
// - On error (auth, network, malformed SSE, HtmlStream.write throws):
//   the stream errors. No credits are debited unless the `usage` event
//   landed before the error.

import {
  GeminiProvider as RealGeminiProvider,
  type InlineImage,
  type Message,
  type StreamEvent,
} from "@/lib/ai-gateway";
import {
  HtmlStream as RealHtmlStream,
  sanitizeForPublish,
  type HtmlStreamOpts,
  type HtmlStreamResult,
} from "@/lib/html-engine";
import { extractTwConfig, injectTwCarrier } from "@/lib/publish/tw-config";
import { hardenVisualQuality } from "@/lib/harden";
import { creditsForUsage, debitCredits as realDebitCredits, type CreditRate } from "@/lib/credits";
import { createFireworksStreamClient } from "@/lib/ai/fireworks-stream-client";
import { messagesForFireworks } from "@/lib/agent/fireworks-bridge";
import { resolveAIProvider, type AIModel } from "@/lib/ai-provider";
import { usesDeepSeekForTurn, writerForTurn, type TurnWriter } from "@/lib/ai/provider-switch";
import { fireworksStreamProvider } from "@/lib/ai/fireworks-as-stream-provider";
import type { FableModelOperation } from "@/lib/generation/fable-model-policy";
import { extractModelRuntime, modelJsEnabled } from "./model-runtime";
import { extractModelPrueba } from "./model-prueba";
import type { PasoSpec } from "@/lib/agent/behavior-spec";

const DEFAULT_MODEL: AIModel = "gemini-pro";

// Quality S1 post-processor — runs once at end-of-stream on the canonical
// HTML before the summary resolves. Border alpha caps + Tailwind class
// normalization are applied silently; banned-phrase + generic-CTA warnings
// are logged. Idempotent: a no-op when the HTML is already clean.
//
// Failure mode: if hardening throws (binding missing, malformed regex), the
// original HTML is returned unchanged. The Rust impl never throws on valid
// input, so the catch is purely defensive.
function applyHardening(html: string | null): string | null {
  if (html === null || html.length === 0) return html;
  try {
    const r = hardenVisualQuality(html);
    if (
      r.counts.whiteAlphaCapped +
        r.counts.blackAlphaCapped +
        r.counts.tailwindWhiteNormalized +
        r.counts.tailwindBlackNormalized >
      0
    ) {
      // eslint-disable-next-line no-console
      console.log(
        "[generate] hardened — w:%d b:%d tw-w:%d tw-b:%d",
        r.counts.whiteAlphaCapped,
        r.counts.blackAlphaCapped,
        r.counts.tailwindWhiteNormalized,
        r.counts.tailwindBlackNormalized,
      );
    }
    if (r.warnings.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "[generate] harden warnings: %s",
        r.warnings.map((w) => `${w.kind}:${w.matched}`).join(", "),
      );
    }
    return r.html;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[generate] hardenVisualQuality threw — using raw HTML", err);
    return html;
  }
}

// ── Contrato de ingestión (bug bypass, 2026-07-29) ──────────────────────────
// El pipeline de streaming sanitiza para el PREVIEW, con dos huecos frente a
// la puerta síncrona que usan las demás rutas: (1) borra el
// <script>tailwind.config…</script> del modelo ANTES de que extractTwConfig
// pueda leerlo — la paleta se perdía en silencio; y (2) whitelistea CUALQUIER
// <script data-ol-*> por prefijo, así que un modelo bajo prompt-injection
// podía colar un script con ese atributo hasta la DB y el iframe del editor
// (que corre allow-same-origin). Antes de resolver `done`, el HTML canónico
// pasa por sanitizeForPublish — el MISMO contrato que from-html /
// from-template / ai-design — y la paleta se rescata del texto CRUDO del
// modelo (el único lugar donde el script de config todavía existe).
const CARRIER_MARK_RE = /\bdata-ol-tw\b/;

function canonicalizeFinalHtml(
  html: string | null,
  rawText: string,
): string | null {
  if (html === null || html.length === 0) return html;
  const sanitized = sanitizeForPublish(html);
  if (sanitized.html === null) {
    // Solo el gate slot-path produce null, y el stream ya lo mata chunk a
    // chunk — si dispara aquí el documento está envenenado: mejor fallar la
    // generación que persistirlo.
    throw new Error(
      `generate: sanitize gate (${sanitized.errors.join("; ")})`,
    );
  }
  let out = sanitized.html;
  if (!CARRIER_MARK_RE.test(out)) {
    const { extend } = extractTwConfig(rawText);
    if (extend !== null) out = injectTwCarrier(out, extend);
  }
  return out;
}

// ─── Public types ──────────────────────────────────────────────────────────

export interface GenerateHtmlStreamOpts {
  /** Gemini API key. */
  apiKey: string;
  messages: Message[];
  /** Reference images attached to the last user message (Quality S2
   *  multimodal reference). Empty/omitted = text-only. */
  images?: InlineImage[];
  /** Credit-rate key + provider model picker. Defaults to "gemini-pro". */
  model?: AIModel;
  /** Cancel the in-flight generation. The stream closes within ~500 ms;
   *  credits are NOT debited if cancellation lands before the `usage`
   *  event. (If `usage` already fired, the debit happened before the
   *  cancel — there is no refund.) */
  signal?: AbortSignal;
  /** User ID for credit accounting. */
  userId: string;
  /** HtmlStream configuration. Defaults (set by the Rust crate):
   *  injectOpIds = true, sanitize = true, normalizeOnEnd = true,
   *  minifyOnEnd = false. */
  htmlOpts?: HtmlStreamOpts;
  maxOutputTokens?: number;
  temperature?: number;
  /** Qué trabajo es éste, para la política de modelo/esfuerzo. Omitido = lo
   *  que corre hoy. NO viaja al modelo. */
  operation?: FableModelOperation;
}

export type GenerateHtmlStopKind =
  | "end_turn"
  | "max_tokens"
  | "cancelled"
  | "error";

export interface GenerateHtmlStreamUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateHtmlStreamSummary {
  /** Post-end() canonical HTML. `null` on cancellation or any error path
   *  that prevented HtmlStream.end() from running. */
  finalHtml: string | null;
  /** Counters returned by HtmlStream.end(). `null` if end() was not
   *  called (cancellation, pre-end error). */
  result: HtmlStreamResult | null;
  /** Provider-reported token usage. `null` if the `usage` event did not
   *  arrive (cancellation pre-usage, early error). */
  usage: GenerateHtmlStreamUsage | null;
  /** Credits actually debited. 0 when the `usage` event didn't arrive or
   *  the debit threw (debit errors are logged but don't propagate). */
  creditsDebited: number;
  stopKind: GenerateHtmlStopKind;
  /** Populated when `stopKind === "error"`. */
  error: Error | null;
  /** Quién escribió DE VERDAD esta página. Se expone en vez de dejar que
   *  cada llamador lo vuelva a deducir: `pageWriterUsesDeepSeek` depende de
   *  si había imágenes adjuntas, y quien lo re-infiera más tarde, con otro
   *  estado a mano, puede acertar hoy y equivocarse mañana. */
  wroteWith: "deepseek" | "gemini";
  /** El runtime que escribió el modelo, sacado de su respuesta CRUDA antes
   *  de que el sanitizador lo borrara. `null` salvo que OPENLEN_MODEL_JS=1,
   *  lo escribiera DeepSeek y el script cumpla el contrato. NADA lo ejecuta
   *  ni lo guarda todavía: `finalHtml` sigue saliendo sin scripts. */
  modelRuntime: string | null;
  /** LA PRUEBA QUE EL PROPIO MODELO DECLARÓ para ese runtime: qué debe pasar
   *  al usar la página. Sale del mismo texto crudo y por el mismo interruptor,
   *  y sólo cuando hay runtime — una promesa sin código que la cumpla no tiene
   *  autor. Ausente en todo lo demás; nada la ejecuta aquí. */
  modelPrueba?: readonly PasoSpec[];
}

export interface GenerateHtmlStreamResult {
  /** Per-write HTML chunks emitted by HtmlStream — suitable for live
   *  preview. Concatenation is NOT byte-equal to `done.finalHtml` because
   *  HtmlStream.end() applies normalize/minify that can rewrite the
   *  document. Read this stream for live preview, await `done` for the
   *  canonical output. */
  stream: ReadableStream<Uint8Array>;
  /** Resolves once the stream closes (normal, cancelled, or errored).
   *  Never rejects — error info lives in `.error` / `.stopKind`. */
  done: Promise<GenerateHtmlStreamSummary>;
}

// ─── Test-only injection points ────────────────────────────────────────────
//
// These let `lib/ai-stream/generate.test.ts` swap the live provider, debit
// function, and HtmlStream constructor for in-memory fakes. Production
// callers should NOT pass an `internals` argument.

export interface GenerateHtmlStreamInternals {
  provider?: GeminiProviderLike;
  /** Con qué motor fingir que se escribió. Existe porque inyectar un
   *  proveedor apaga `wantsDeepSeek` por definición, y sin esta costura la
   *  captura del runtime del modelo —que EXIGE DeepSeek— sería imposible de
   *  probar: el test pasaría en verde sin haber ejercitado nada. */
  wroteWith?: "deepseek" | "gemini";
  debit?: DebitFn;
  makeHtmlStream?: (opts: HtmlStreamOpts | undefined) => HtmlStreamLike;
}

export interface GeminiProviderLike {
  stream(
    request: {
      model: string;
      messages: Message[];
      maxOutputTokens?: number;
      temperature?: number;
      images?: InlineImage[];
    },
    opts: { signal?: AbortSignal },
  ): AsyncIterableIterator<StreamEvent>;
}

export type DebitFn = (userId: string, amount: number) => Promise<void>;

export interface HtmlStreamLike {
  write(chunk: string): string;
  end(): HtmlStreamResult;
}

// ─── Implementation ────────────────────────────────────────────────────────

/** Quién escribe la página. Medido sobre los mismos cuatro briefs: escrita de
 *  una pasada trae cero defectos deterministas y cuesta la quinta parte que
 *  parchear una baseline. `OPENLEN_GENERATE_PROVIDER=gemini` vuelve atrás.
 *
 *  Las imágenes de referencia fijan el turno a Gemini: el papel que razona en
 *  Fireworks no tiene visión, y una referencia que el modelo no ve es peor que
 *  no haberla pedido. */
export function pageWriterUsesDeepSeek(
  env: Readonly<Record<string, string | undefined>> = process.env,
  hasImages = false,
): boolean {
  return usesDeepSeekForTurn("OPENLEN_GENERATE_PROVIDER", hasImages, env);
}

/** `operation` NO viaja al modelo: el cliente sólo la usa para elegir papel y
 *  `reasoning_effort` (fireworks-stream-client, cuerpo de la petición). Es un
 *  parámetro para que un experimento pueda variar el esfuerzo sin tocar la
 *  política; el valor por defecto es el que corre hoy. */
function createDeepSeekPageProvider(
  operation: FableModelOperation = "page_edit",
): GeminiProviderLike {
  const client = createFireworksStreamClient();
  return {
    async *stream(request, streamOpts) {
      const source = client.stream(
        {
          messages: messagesForFireworks(request.messages),
          maxOutputTokens: request.maxOutputTokens ?? 60_000,
          temperature: request.temperature ?? 0.8,
          requestId: `generate.${Math.random().toString(36).slice(2, 14)}`,
          // El papel que razona, sin presupuesto de pensamiento: medido en esta
          // misma superficie, pensar costaba tiempo y producía menos.
          operation,
        },
        streamOpts,
      );
      for await (const event of source) {
        // El razonamiento no es la página.
        if (event.type === "reasoning_delta") continue;
        yield event;
      }
    },
  };
}

export function generateHtmlStream(
  opts: GenerateHtmlStreamOpts,
  internals: GenerateHtmlStreamInternals = {},
): GenerateHtmlStreamResult {
  const modelKey: AIModel = opts.model ?? DEFAULT_MODEL;
  const geminiModel = resolveAIProvider(modelKey).model;

  // Un proveedor inyectado (las pruebas) manda: ni cambia de motor ni de tarifa.
  //
  // Con una imagen adjunta escribe QWEN, no Gemini: el razonador no tiene ojos
  // pero el papel con visión sí, y viaja por el mismo transporte. Gemini se
  // queda para los píxeles. `OPENLEN_GENERATE_PROVIDER=gemini` vuelve atrás.
  const writer: TurnWriter =
    internals.provider !== undefined
      ? "gemini"
      : writerForTurn("OPENLEN_GENERATE_PROVIDER", (opts.images?.length ?? 0) > 0, process.env);
  const provider: GeminiProviderLike =
    internals.provider ??
    (writer === "deepseek"
      ? createDeepSeekPageProvider(opts.operation)
      : writer === "qwen"
        ? (fireworksStreamProvider({
            requestId: `generate.ref.${Math.random().toString(36).slice(2, 10)}`,
            operation: "page_write_with_reference",
            maxOutputTokens: 60_000,
            temperature: 0.8,
          }) as unknown as GeminiProviderLike)
        : (new RealGeminiProvider(opts.apiKey) as unknown as GeminiProviderLike));
  // La tarifa sigue a quien de verdad corrió, no al modelo que se pidió. Qwen
  // cuesta ~10x la salida de DeepSeek: cobrarlo como razonador sería regalar la
  // diferencia justo en los turnos más caros.
  const creditRate: CreditRate =
    writer === "deepseek" ? "deepseek-flash" : writer === "qwen" ? "qwen-vision" : modelKey;
  // La captura del runtime sigue atada a DeepSeek: la cápsula se llama
  // "deepseek-generate-v1" y firmar bytes de otro proveedor creyéndolos suyos es
  // justo lo que un hash no puede detectar. Un turno con referencia no captura.
  const wroteWith: "deepseek" | "gemini" =
    internals.wroteWith ?? (writer === "deepseek" ? "deepseek" : "gemini");

  // Captura del runtime del modelo — Etapa 1 de abrir JavaScript.
  //
  // Se lee del texto CRUDO del proveedor porque para cuando existe `finalHtml`
  // el script ya no está: el sanitizador corre en el propio streaming. NO se
  // toca `sanitize`: ese interruptor no sólo suelta los scripts, también
  // suelta manejadores `on*`, URLs peligrosas e iframes.
  //
  // Sólo si lo escribió DeepSeek. Con Gemini —al que se desvía el turno cuando
  // hay imágenes adjuntas— la procedencia sería otra, y la Etapa 2 va a firmar
  // estos bytes: firmar los de un proveedor creyéndolos de otro es exactamente
  // la clase de error que un hash no puede detectar.
  //
  // Capturar NO es publicar. Hoy esto se devuelve y nadie lo usa.
  const capturarRuntime = (): string | null => {
    if (!modelJsEnabled(process.env) || wroteWith !== "deepseek") return null;
    const r = extractModelRuntime(rawText);
    if (!r.ok) {
      if (r.reason !== "ausente") {
        // eslint-disable-next-line no-console
        console.warn(`[generate] runtime del modelo descartado: ${r.reason}`);
      }
      return null;
    }
    return r.code;
  };
  /** Sólo se pide cuando el runtime sobrevivió: probar el comportamiento de una
   *  página sin código es probar el HTML, y eso no es lo que esto mide. */
  const capturarPrueba = (runtime: string | null): readonly PasoSpec[] | undefined => {
    if (!runtime) return undefined;
    const p = extractModelPrueba(rawText);
    if (!p.ok) {
      if (p.reason !== "ausente") {
        // eslint-disable-next-line no-console
        console.warn(`[generate] prueba del modelo descartada: ${p.reason}`);
      }
      return undefined;
    }
    return p.pasos;
  };
  const debit: DebitFn = internals.debit ?? realDebitCredits;
  const htmlStream: HtmlStreamLike = internals.makeHtmlStream
    ? internals.makeHtmlStream(opts.htmlOpts)
    : (new RealHtmlStream(opts.htmlOpts) as unknown as HtmlStreamLike);

  // Internal abort bridges (a) opts.signal and (b) consumer cancel via
  // `stream.cancel()` to the upstream GeminiProvider. The provider sees a
  // single AbortSignal and never needs to know which side fired.
  const internalAbort = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) {
      internalAbort.abort();
    } else {
      opts.signal.addEventListener("abort", () => internalAbort.abort(), {
        once: true,
      });
    }
  }

  let resolveDone!: (s: GenerateHtmlStreamSummary) => void;
  const done = new Promise<GenerateHtmlStreamSummary>((r) => {
    resolveDone = r;
  });

  const encoder = new TextEncoder();
  let usage: GenerateHtmlStreamUsage | null = null;
  let creditsDebited = 0;
  // Texto CRUDO del modelo — el pipeline borra el script de tailwind.config
  // al vuelo, así que la paleta solo puede rescatarse de aquí (acotado por
  // maxOutputTokens; se descarta al resolver `done`).
  let rawText = "";

  // Arma el summary de éxito: harden + contrato de ingestión. Si el gate del
  // sanitize dispara (documento envenenado), la generación falla como error —
  // jamás se entrega HTML sin puerta.
  const finishSummary = (
    endResult: HtmlStreamResult,
    stopKind: "end_turn" | "max_tokens",
  ): GenerateHtmlStreamSummary => {
    try {
      return {
        finalHtml: canonicalizeFinalHtml(
          applyHardening(endResult.finalHtml),
          rawText,
        ),
        result: endResult,
        usage,
        creditsDebited,
        stopKind,
        error: null,
        wroteWith,
        ...(() => {
          const runtime = capturarRuntime();
          const prueba = capturarPrueba(runtime);
          return { modelRuntime: runtime, ...(prueba ? { modelPrueba: prueba } : {}) };
        })(),
      };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      return {
        finalHtml: null,
        wroteWith,
        modelRuntime: null,
        result: null,
        usage,
        creditsDebited,
        stopKind: "error",
        error: e,
      };
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Once errored or closed, subsequent controller calls throw.
      // Wrap to ignore the post-close call site so the resolveDone path
      // still runs cleanly.
      const safeError = (err: Error) => {
        try {
          controller.error(err);
        } catch {
          /* already errored/closed */
        }
      };
      const safeClose = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const safeEnqueue = (bytes: Uint8Array) => {
        try {
          controller.enqueue(bytes);
        } catch {
          /* already closed; drop the chunk */
        }
      };

      let events: AsyncIterableIterator<StreamEvent>;
      try {
        events = provider.stream(
          {
            model: geminiModel,
            messages: opts.messages,
            maxOutputTokens: opts.maxOutputTokens,
            temperature: opts.temperature,
            images: opts.images,
          },
          { signal: internalAbort.signal },
        );
      } catch (constructErr) {
        // Synchronous failure constructing the stream (e.g. provider
        // constructor or stream() rejected the request shape).
        const err =
          constructErr instanceof Error
            ? constructErr
            : new Error(String(constructErr));
        safeError(err);
        resolveDone({
          finalHtml: null,
        wroteWith,
        modelRuntime: null,
          result: null,
          usage: null,
          creditsDebited: 0,
          stopKind: "error",
          error: err,
        });
        return;
      }

      try {
        for await (const event of events) {
          if (event.type === "text_delta") {
            rawText += event.text;
            let processed: string;
            try {
              processed = htmlStream.write(event.text);
            } catch (writeErr) {
              const err =
                writeErr instanceof Error
                  ? writeErr
                  : new Error(String(writeErr));
              safeError(err);
              resolveDone({
                finalHtml: null,
        wroteWith,
        modelRuntime: null,
                result: null,
                usage,
                creditsDebited,
                stopKind: "error",
                error: err,
              });
              return;
            }
            if (processed.length > 0) {
              safeEnqueue(encoder.encode(processed));
            }
          } else if (event.type === "usage") {
            usage = {
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
            };
            const credits = creditsForUsage(
              event.inputTokens,
              event.outputTokens,
              creditRate,
            );
            try {
              await debit(opts.userId, credits);
              creditsDebited = credits;
            } catch (debitErr) {
              // Best-effort accounting; don't break the stream. The
              // generation has already partly streamed to the user; keep
              // serving and reconcile via the ledger separately.
              // eslint-disable-next-line no-console
              console.error(
                "[generateHtmlStream] credit debit failed (user=%s, credits=%d): %o",
                opts.userId,
                credits,
                debitErr,
              );
            }
          } else if (event.type === "done") {
            switch (event.stopReason.kind) {
              case "end_turn":
              case "max_tokens": {
                let endResult: HtmlStreamResult;
                try {
                  endResult = htmlStream.end();
                } catch (endErr) {
                  // HtmlStream.end() can throw on sticky slot-path or a
                  // poisoned pipeline. Surface as error.
                  const err =
                    endErr instanceof Error
                      ? endErr
                      : new Error(String(endErr));
                  safeError(err);
                  resolveDone({
                    finalHtml: null,
        wroteWith,
        modelRuntime: null,
                    result: null,
                    usage,
                    creditsDebited,
                    stopKind: "error",
                    error: err,
                  });
                  return;
                }
                safeClose();
                resolveDone(finishSummary(endResult, event.stopReason.kind));
                return;
              }
              case "cancelled": {
                // Partial document — drop HtmlStream without end().
                safeClose();
                resolveDone({
                  finalHtml: null,
        wroteWith,
        modelRuntime: null,
                  result: null,
                  usage,
                  creditsDebited,
                  stopKind: "cancelled",
                  error: null,
                });
                return;
              }
              case "error": {
                const err = new Error(event.stopReason.error);
                safeError(err);
                resolveDone({
                  finalHtml: null,
        wroteWith,
        modelRuntime: null,
                  result: null,
                  usage,
                  creditsDebited,
                  stopKind: "error",
                  error: err,
                });
                return;
              }
            }
          }
          // "start" event: nothing to do at the helper level.
        }
        // Iterator returned without a terminal "done" event — shouldn't
        // happen with a well-formed provider, but treat as end_turn so
        // the consumer still gets a final HTML.
        let endResult: HtmlStreamResult | null = null;
        try {
          endResult = htmlStream.end();
        } catch (endErr) {
          const err =
            endErr instanceof Error ? endErr : new Error(String(endErr));
          safeError(err);
          resolveDone({
            finalHtml: null,
        wroteWith,
        modelRuntime: null,
            result: null,
            usage,
            creditsDebited,
            stopKind: "error",
            error: err,
          });
          return;
        }
        safeClose();
        resolveDone(finishSummary(endResult, "end_turn"));
      } catch (loopErr) {
        // Provider-level throw (auth error, network drop, malformed SSE).
        const err =
          loopErr instanceof Error ? loopErr : new Error(String(loopErr));
        safeError(err);
        resolveDone({
          finalHtml: null,
        wroteWith,
        modelRuntime: null,
          result: null,
          usage,
          creditsDebited,
          stopKind: "error",
          error: err,
        });
      }
    },
    cancel(_reason) {
      // Consumer-side cancel (reader.cancel() or aborted Response body).
      // Forward to upstream — the provider yields Done{Cancelled} and the
      // for-await exits via the cancelled branch above.
      internalAbort.abort();
    },
  });

  return { stream, done };
}
