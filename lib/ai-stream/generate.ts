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
//   token counts the provider reports. A failed debit is retried ONCE and
//   then logged; it never breaks the stream — the page is already half-drawn
//   on the user's screen. There is NO reconciliation ledger (an older
//   comment here promised one; it never existed). What there IS:
// - If a full page ships and `usage` NEVER arrived, the floor (1 credit) is
//   charged. The adapter's contract treats `usage` as optional, so hanging
//   the whole charge off it meant a complete document could be delivered
//   with creditsDebited: 0 and no trace.
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

import type {
  InlineImage,
  Message,
  StreamEvent,
} from "@/lib/ai-gateway";
import {
  HtmlStream as RealHtmlStream,
  gateReservedMarker,
  type HtmlStreamOpts,
  type HtmlStreamResult,
} from "@/lib/html-engine";
import { extractTwConfig, injectTwCarrier } from "@/lib/publish/tw-config";
import { hardenVisualQuality } from "@/lib/harden";
import { creditsForUsage, debitCredits as realDebitCredits, type CreditRate } from "@/lib/credits";
import { createFireworksStreamClient } from "@/lib/ai/fireworks-stream-client";
import { messagesForFireworks } from "@/lib/agent/fireworks-bridge";
import { writerForTurn, type TurnWriter } from "@/lib/ai/provider-switch";
import { fireworksStreamProvider } from "@/lib/ai/fireworks-as-stream-provider";
import type { ModelOperation } from "@/lib/generation/model-policy";
import { todoElJsDelDocumento } from "@/lib/page-engine/conservar-scripts";
import { extractModelPrueba } from "./model-prueba";
import type { PruebaDeclarada } from "@/lib/agent/behavior-spec";


/** Lo que se cobra por una página entregada cuando el proveedor nunca mandó
 *  `usage`. Medido: una página completa (~20k de entrada, ~15k de salida) sale
 *  a un crédito, así que esto no es un castigo — es el precio normal. Mismo
 *  suelo que aplica el Agente con `Math.max(1, credits)`. */
const CREDITO_SUELO = 1;

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
/** La config que el propio modelo escribió, que ahora ya no se le borra. */
const TW_CONFIG_MARK_RE = /tailwind\s*\.\s*config\s*=/;

function canonicalizeFinalHtml(
  html: string | null,
  rawText: string,
): string | null {
  if (html === null || html.length === 0) return html;
  // LA SALIDA DEL MODELO NO SE SANEA — se le pasa la única puerta que sigue
  // valiendo para todo el mundo, `data-slot-path`. Ver `gateReservedMarker`.
  const gate = gateReservedMarker(html);
  if (gate.html === null) {
    // El stream ya mata el marcador chunk a chunk; si dispara aquí el
    // documento está envenenado: mejor fallar la generación que persistirlo.
    throw new Error(`generate: ${gate.errors.join("; ")}`);
  }
  let out = gate.html;
  // El carrier era el rescate de una paleta que el saneador mataba. Ahora el
  // `<script>tailwind.config…</script>` del modelo SOBREVIVE, así que sólo se
  // injerta cuando de verdad no hay ninguna config en el documento — si no,
  // la página acabaría con dos y ganaría la última por accidente.
  if (!CARRIER_MARK_RE.test(out) && !TW_CONFIG_MARK_RE.test(out)) {
    const { extend } = extractTwConfig(rawText);
    if (extend !== null) out = injectTwCarrier(out, extend);
  }
  return out;
}

// ─── Public types ──────────────────────────────────────────────────────────

export interface GenerateHtmlStreamOpts {
  messages: Message[];
  /** Reference images attached to the last user message (Quality S2
   *  multimodal reference). Empty/omitted = text-only. */
  images?: readonly InlineImage[];
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
  operation?: ModelOperation;
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
  wroteWith: TurnWriter;
  /** El runtime que escribió el modelo, sacado de su respuesta CRUDA antes
   *  de que el sanitizador lo borrara. Hoy el script se queda EN el documento,
   *  lo escribiera DeepSeek y el script cumpla el contrato. NADA lo ejecuta
   *  ni lo guarda todavía: `finalHtml` sigue saliendo sin scripts. */
  /** LA PRUEBA QUE EL PROPIO MODELO DECLARÓ para ese runtime: qué debe pasar
   *  al usar la página. Sale del mismo texto crudo y por el mismo interruptor,
   *  y sólo cuando hay runtime — una promesa sin código que la cumpla no tiene
   *  autor. Ausente en todo lo demás; nada la ejecuta aquí. */
  modelPrueba?: PruebaDeclarada;
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
  provider?: PageStreamProvider;
  /** Con qué motor fingir que se escribió. Existe porque inyectar un
   *  proveedor apaga `wantsDeepSeek` por definición, y sin esta costura la
   *  captura del runtime del modelo —que EXIGE DeepSeek— sería imposible de
   *  probar: el test pasaría en verde sin haber ejercitado nada. */
  wroteWith?: TurnWriter;
  debit?: DebitFn;
  makeHtmlStream?: (opts: HtmlStreamOpts | undefined) => HtmlStreamLike;
}

/** El transporte que este modulo sabe hablar: lo implementan los adaptadores
 *  de Fireworks (DeepSeek para texto, Qwen cuando hay imagen adjunta).
 *
 *  Se llamaba `GeminiProviderLike` porque lo estreno el gateway de Gemini.
 *  Renombrado el 2026-08-28 con la salida del proveedor: un nombre que
 *  describe al PROVEEDOR en vez de al TRABAJO costo cuatro bugs ese mismo dia
 *  —`redesignWithGemini`, `GeminiImageOutcome`, `requestId`,
 *  `AI_IMAGE_EDIT_CREDIT_COST`— y este era el ultimo que quedaba.
 *
 *  `model` es OPCIONAL: lo pone la politica por `operation`. */
export interface PageStreamProvider {
  stream(
    request: {
      model?: string;
      messages: Message[];
      maxOutputTokens?: number;
      temperature?: number;
      images?: readonly InlineImage[];
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
 *  parchear una baseline.
 *
 *  Con imágenes de referencia NO lo escribe el razonador: no tiene visión, y
 *  Fireworks no tiene visión, y una referencia que el modelo no ve es peor que
 *  no haberla pedido. */
export function pageWriterUsesDeepSeek(hasImages = false): boolean {
  return writerForTurn(hasImages) === "deepseek";
}

/** `operation` NO viaja al modelo: el cliente sólo la usa para elegir papel y
 *  `reasoning_effort` (fireworks-stream-client, cuerpo de la petición). Es un
 *  parámetro para que un experimento pueda variar el esfuerzo sin tocar la
 *  política; el valor por defecto es el que corre hoy. */
function createDeepSeekPageProvider(

  operation: ModelOperation = "page_edit",

  afinidad?: string,

): PageStreamProvider {
  const client = createFireworksStreamClient();
  return {
    async *stream(request, streamOpts) {
      const source = client.stream(
        {
          messages: messagesForFireworks(request.messages),
          maxOutputTokens: request.maxOutputTokens ?? 60_000,
          temperature: request.temperature ?? 0.8,
          // AFINIDAD DE CACHÉ, no un identificador de traza. El cliente manda

          // `requestId` en el campo `user` de la petición, y en el serverless de

          // Fireworks la caché es POR RÉPLICA: ese campo es lo que decide a cuál

          // vas. Con `Math.random()` cada llamada aterrizaba en otra, así que el

          // prefijo —idéntico en todas— no se reutilizaba nunca.

          //

          // No es una sola llamada: crear una página son la escritura, la pasada

          // de reparación y UNA MÁS POR SUBPÁGINA, todas con el mismo prompt de

          // sistema. Eran N réplicas distintas para un prefijo compartido.

          //

          // La clave es el usuario porque al crear todavía no hay proyecto (el

          // Agente ya usa `projectId`). Así se reutiliza dentro de una generación

          // y entre generaciones seguidas del mismo usuario, mientras dure el TTL.

          requestId: afinidad ?? `generate.${Math.random().toString(36).slice(2, 14)}`,
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
  // Con una imagen adjunta escribe QWEN: el razonador no tiene ojos pero el
  // papel con vision si, y viaja por el mismo transporte.
  //
  // Aqui habia una tercera rama que etiquetaba de Gemini TODO proveedor
  // inyectado. Un doble de prueba no dice quien habria corrido; lo dice el
  // turno. Con el proveedor fuera, el papel se deduce igual se inyecte o no.
  const writer: TurnWriter = writerForTurn((opts.images?.length ?? 0) > 0);
  const provider: PageStreamProvider =
    internals.provider ??
    (writer === "deepseek"
      ? createDeepSeekPageProvider(opts.operation, `u.${opts.userId}`)
      : (fireworksStreamProvider({
          // Misma razon que arriba: afinidad, no traza. Qwen es otro modelo y
          // por tanto otro espacio de cache, pero dentro del suyo aplica igual.
          requestId: `u.${opts.userId}`,
          operation: "page_write_with_reference",
          maxOutputTokens: 60_000,
          temperature: 0.8,
        }) as unknown as PageStreamProvider));
  // La tarifa sigue a quien de verdad corrio. Qwen cuesta ~10x la salida de
  // DeepSeek: cobrarlo como razonador seria regalar la diferencia justo en los
  // turnos mas caros.
  const creditRate: CreditRate = writer === "deepseek" ? "deepseek-flash" : "qwen-vision";
  const wroteWith: TurnWriter = internals.wroteWith ?? writer;
  // La captura del runtime sigue atada a DeepSeek: la cápsula se llama
  // "deepseek-generate-v1" y firmar bytes de otro proveedor creyéndolos suyos es
  // justo lo que un hash no puede detectar. Un turno con referencia no captura.

  // ⚰️ AQUI VIVIA `capturarRuntime`, la captura del JavaScript del modelo
  // sobre el texto crudo. Retirada el 2026-09-04, por dos motivos a la vez:
  //
  //   1. NO PODIA TENER EXITO. `extractModelRuntime` cuenta CUALQUIER
  //      <script>, y el contrato obliga al de Tailwind por CDN en todas las
  //      paginas: con el JavaScript del modelo son dos, y devuelve «varios».
  //      Medido sobre el documento real. El comentario de aqui abajo ya lo
  //      sabia y rodeo el problema para la PRUEBA; la captura se quedo rota.
  //   2. NADIE LA USABA. Su propio comentario lo decia — «capturar NO es
  //      publicar, hoy esto se devuelve y nadie lo usa»— y era literal: en la
  //      ruta, `runtimeCode` se asignaba y no se leia jamas.
  //
  // Y no se pierde nada: desde el 2026-08-26 el <script> del modelo vive
  // DENTRO del documento y se guarda con el. La puerta de este motor es
  // `gateReservedMarker`, que no le recorta scripts a nadie. Comprobado de
  // punta a punta antes de retirar esto.
  /**
   * Sólo se pide cuando la página TIENE código: probar el comportamiento de una
   * página sin JavaScript es probar el HTML, y eso no es lo que esto mide.
   *
   * SE PREGUNTA AL DOCUMENTO, y no al extractor de runtime. Aquel rechaza los
   * documentos con más de un `<script>` («varios») porque la cápsula firmaba UN
   * bloque con un hash; atar la prueba a él la apagaba en cualquier página con
   * dos scripts, que es la mayoría. Medido el 2026-08-26: el modelo declaró su
   * prueba, la página traía varios bloques, y la prueba no llegó a correr — en
   * silencio, que es la peor forma.
   */
  const capturarPrueba = (documento: string): PruebaDeclarada | undefined => {
    if (!todoElJsDelDocumento(documento).trim()) return undefined;
    const p = extractModelPrueba(rawText);
    if (!p.ok) {
      if (p.reason !== "ausente") {
        // eslint-disable-next-line no-console
        console.warn(`[generate] prueba del modelo descartada: ${p.reason}`);
      }
      return undefined;
    }
    return p.prueba;
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
  /**
   * UN BLIP NO PUEDE SALIR GRATIS.
   *
   * `debitCredits` es un UPDATE remoto: puede rechazar. Antes, un rechazo se
   * registraba y ya — el comentario decía «reconcile via the ledger
   * separately» y ese ledger NO EXISTE: no hay tabla, ni outbox, ni proceso
   * que lo lea. Un log que nadie lee no es una solución.
   *
   * Lo proporcionado aquí es reintentar UNA vez: es una fila, no hay estado
   * que reconciliar, y el fallo típico es transitorio. Si vuelve a fallar se
   * registra y se sigue sirviendo — la página ya está a medio escribir en la
   * pantalla del usuario y tumbarla por la contabilidad sería peor.
   *
   * Deliberadamente NO se construye un ledger ni una cola: medido, una página
   * entera cuesta 1 crédito y el techo de un usuario gratis son veinte
   * céntimos al mes.
   */
  const intentarDebito = async (credits: number): Promise<boolean> => {
    for (let intento = 1; intento <= 2; intento += 1) {
      try {
        await debit(opts.userId, credits);
        return true;
      } catch (debitErr) {
        if (intento === 2) {
          // eslint-disable-next-line no-console
          console.error(
            "[generateHtmlStream] débito fallido tras 2 intentos (user=%s, credits=%d): %o",
            opts.userId,
            credits,
            debitErr,
          );
        }
      }
    }
    return false;
  };

  /**
   * SI SE ENTREGÓ UNA PÁGINA, SE COBRA.
   *
   * El cargo colgaba enteramente del evento `usage`, que el contrato del
   * adaptador trata como OPCIONAL. Un proveedor que cierra sin mandarlo
   * entregaba el documento completo con `creditsDebited: 0` y nadie se
   * enteraba. Ahora, si hubo página final y nunca llegó `usage`, se cobra el
   * suelo: una página entera vale un crédito (medido), así que es exactamente
   * lo que ese turno habría costado.
   *
   * Sólo con página. Cancelado o error siguen siendo gratis — eso es política
   * y no cambia (ver la nota de cancelación arriba).
   */
  const conCobroDeSuelo = async (
    summary: GenerateHtmlStreamSummary,
  ): Promise<GenerateHtmlStreamSummary> => {
    if (!summary.finalHtml || summary.usage || summary.creditsDebited > 0) {
      return summary;
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[generateHtmlStream] página entregada sin evento `usage` — se cobra el suelo (user=%s)",
      opts.userId,
    );
    if (!(await intentarDebito(CREDITO_SUELO))) return summary;
    creditsDebited = CREDITO_SUELO;
    return { ...summary, creditsDebited: CREDITO_SUELO };
  };

  const finishSummary = (
    endResult: HtmlStreamResult,
    stopKind: "end_turn" | "max_tokens",
  ): GenerateHtmlStreamSummary => {
    try {
      // Se calcula UNA vez: es el documento que se entrega y también el que se
      // le pregunta por su JavaScript.
      const documento = canonicalizeFinalHtml(applyHardening(endResult.finalHtml), rawText);
      return {
        finalHtml: documento,
        result: endResult,
        usage,
        creditsDebited,
        stopKind,
        error: null,
        wroteWith,
        ...(() => {
          const prueba = capturarPrueba(documento ?? "");
          return {
            ...(prueba ? { modelPrueba: prueba } : {}),
          };
        })(),
      };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      return {
        finalHtml: null,
        wroteWith,
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
              // La entrada cacheada cuesta ~31x menos y se medía sin cobrarse.
              event.cachedTokens,
            );
            if (await intentarDebito(credits)) creditsDebited = credits;
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
                    result: null,
                    usage,
                    creditsDebited,
                    stopKind: "error",
                    error: err,
                  });
                  return;
                }
                safeClose();
                resolveDone(
                  await conCobroDeSuelo(
                    finishSummary(endResult, event.stopReason.kind),
                  ),
                );
                return;
              }
              case "cancelled": {
                // Partial document — drop HtmlStream without end().
                safeClose();
                resolveDone({
                  finalHtml: null,
        wroteWith,
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
            result: null,
            usage,
            creditsDebited,
            stopKind: "error",
            error: err,
          });
          return;
        }
        safeClose();
        resolveDone(await conCobroDeSuelo(finishSummary(endResult, "end_turn")));
      } catch (loopErr) {
        // Provider-level throw (auth error, network drop, malformed SSE).
        const err =
          loopErr instanceof Error ? loopErr : new Error(String(loopErr));
        safeError(err);
        resolveDone({
          finalHtml: null,
        wroteWith,
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
