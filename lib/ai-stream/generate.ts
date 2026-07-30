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
import { creditsForUsage, debitCredits as realDebitCredits } from "@/lib/credits";
import { resolveAIProvider, type AIModel } from "@/lib/ai-provider";

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

export function generateHtmlStream(
  opts: GenerateHtmlStreamOpts,
  internals: GenerateHtmlStreamInternals = {},
): GenerateHtmlStreamResult {
  const modelKey: AIModel = opts.model ?? DEFAULT_MODEL;
  const geminiModel = resolveAIProvider(modelKey).model;

  const provider: GeminiProviderLike =
    internals.provider ??
    (new RealGeminiProvider(opts.apiKey) as unknown as GeminiProviderLike);
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
      };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      return {
        finalHtml: null,
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
              modelKey,
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
