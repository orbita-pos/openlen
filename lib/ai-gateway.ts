// TypeScript shim over the Rust `@openlen/ai-gateway` napi-rs binding.
//
// Why this file exists: the napi crate emits a JS-friendly but
// "flat-tagged" shape for `StreamEvent` — every field optional, a
// `type` string discriminating which fields are populated. The shape
// is mechanical (one field per Rust enum variant payload) and not
// what JS callers actually want to write. This wrapper narrows that
// raw shape into a proper TypeScript discriminated union so callers
// pattern-match cleanly:
//
//   for await (const event of provider.stream(req, { signal })) {
//     if (event.type === "text_delta") process.stdout.write(event.text)
//     if (event.type === "usage")      console.log("tokens:", event)
//     if (event.type === "done")       console.log("reason:", event.stopReason)
//   }
//
// Build prerequisite: `cd crates/ai-gateway && npm run build` must have
// produced `index.js` + `index.d.ts` for this module to type-check.
//
// Thinking-budget gotcha (Gemini 2.5 Flash, observed F3 S1 post-fix):
// Flash applies an internal "thinking budget" before emitting the
// first user-visible token. For trivial prompts (e.g. `"hi"`) and a
// stingy `maxOutputTokens` (≤ 128), the model can spend the entire
// budget thinking and emit zero output tokens — the stream ends with
// `usage` + `done { kind: 'max_tokens' }` but no `text_delta` events.
// Pass `maxOutputTokens >= 256` for prompts of any length to ensure
// at least a few output tokens land in the budget. See
// docs/rust-f3-session1-handoff.md for the original incident.


// ─── Public types ──────────────────────────────────────────────────────────

export type Role = "system" | "user" | "assistant";

export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
  /** Gemini 3 thought signature attached to this call. MUST be echoed back
   *  verbatim in the `functionCalls` entry when this assistant turn is
   *  replayed in a later request, or the API 400s with "Function call is
   *  missing a thought_signature". */
  thoughtSignature?: string;
}

export interface FunctionResponse {
  name: string;
  response: Record<string, unknown>;
}

export interface Message {
  role: Role;
  content: string;
  /** Assistant turn: tool calls que el modelo emitió (protocolo FC). */
  functionCalls?: FunctionCall[];
  /** User turn: resultados de herramientas de vuelta al modelo. */
  functionResponses?: FunctionResponse[];
}

/** A reference image attached to a request. Rendered as a native Gemini
 *  `inlineData` part on the last user content (Quality S2). The native API
 *  can't fetch remote URLs, so callers pass base64 bytes (no `data:`
 *  prefix). */
export interface InlineImage {
  mimeType: string;
  dataBase64: string;
}

export interface StreamRequest {
  model: string;
  messages: Message[];
  /** Gemini 2.5 Flash: keep `>= 256` for any prompt to avoid empty
   *  output due to thinking-budget consumption (see file header). */
  maxOutputTokens?: number;
  /** Range 0.0–2.0; passed verbatim to Gemini. */
  temperature?: number;
  /** Reference images attached to the LAST user message. Empty/omitted for
   *  the text-only path. */
  images?: readonly InlineImage[];
  // ⚰️ AQUI VIVIAN `responseMimeType` y `responseSchema`, y se van por la misma
  // razon que se borro el crate: no los lee nadie.
  //
  // Eran los controles nativos de Gemini —«sent verbatim as
  // generationConfig.responseSchema», decia su propia documentacion— y el
  // transporte que los estrenó se fue el 2026-08-28. El adaptador de Fireworks
  // (`lib/ai/fireworks-as-stream-provider.ts`) NO los reenvia, y su cabecera
  // dice por que, medido: «el modo estricto de Fireworks rechaza esquemas
  // validos». En el lado Rust tampoco existen: ni un `.rs` del repo los nombra.
  //
  // 🔴 EL TIPO ERA EL QUE LOS MANTENIA VIVOS. Mientras los ofreciera, cada
  // superficie nueva los ponia de buena fe y se quedaba creyendo que su salida
  // estaba sujeta por un esquema. Llego a pasar en cuatro sitios a la vez —los
  // ojos del Agente, el traductor de publicacion, el asistente del sitio y un
  // import huerfano en un eval—, y en el traductor costo caro: el contrato de
  // salida se perdio con el esquema, nadie lo puso en el prompt, y esa funcion
  // NO tradujo nunca una pagina en produccion.
  //
  // COMO SE PIDE JSON HOY: `jsonObject` en la construccion del proveedor, que
  // es lo unico que el adaptador lee y lo unico que llega al cable
  // (`response_format: { type: "json_object" }`). La FORMA de la respuesta se
  // declara en el prompt y la hace cumplir el parser de cada llamador.
  //
  // Si algun dia vuelve un transporte con esquema estricto, esto son dos
  // lineas — pero que vuelvan con un adaptador que de verdad las lea.
  //
  // ⚰️ Y AQUI VIVIAN `thinkingBudget`, `tools` y `toolMode`, de la misma
  // herencia y retirados el 2026-09-10 por la misma razon. MEDIDO antes de
  // tocar nada: los dos unicos llamadores del tipo —`lib/agent/verify.ts`, dos
  // llamadas, y `lib/agent/redesign.ts`, una— no pasaban ninguno de los tres, y
  // el adaptador (`lib/ai/fireworks-as-stream-provider.ts`) construye
  // exactamente `messages`, `images`, `jsonObject`, `maxOutputTokens`,
  // `temperature`, `requestId` y `operation`: ninguno de los tres llegaba al
  // cable. En el lado Rust tampoco existen.
  //
  // 🔴 LA TRAMPA, por si vuelve la tentacion de «reponerlos para el Agente»: el
  // tool-calling del Agente es REAL, pero va por OTRO tipo —
  // `FireworksStreamRequest.tools`, en `lib/ai/fireworks-stream-client.ts`, en
  // formato OpenAI—, no por estos, que eran el subconjunto de Gemini con los
  // `type` en MAYUSCULAS. Y «apagar las herramientas» no se pide con un modo:
  // `brain.ts` OMITE la clave (`withTools ? { tools: wireTools } : {}`), que es
  // exactamente lo que hace `closeOut`.
}

export type StreamEvent =
  | { type: "start"; id: string }
  | { type: "text_delta"; text: string }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      /** Gemini 2.5+ implicit caching (on by default): the subset of
       *  `inputTokens` that hit the cache this turn, billed at a 90%
       *  discount automatically on Google's invoice. `0` when the turn
       *  had no cache hit. */
      cachedTokens: number;
      /** Provider-reported internal reasoning tokens; `0` when absent. */
      thinkingTokens: number;
    }
  | { type: "done"; stopReason: StopReason }
  | {
      type: "function_call";
      name: string;
      args: Record<string, unknown>;
      thoughtSignature?: string;
    };

export type StopReason =
  | { kind: "end_turn" }
  | { kind: "max_tokens" }
  | { kind: "cancelled" }
  | { kind: "error"; error: string };

export type GatewayErrorKind =
  | "api"
  | "network"
  | "cancelled"
  | "invalid_response"
  | "rate_limited"
  | "auth";

export class GatewayError extends Error {
  constructor(
    public readonly kind: GatewayErrorKind,
    public readonly retryable: boolean,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export interface StreamOptions {
  /** Abort the stream from JS. The signal is wired to the inner
   *  Rust `CancellationToken`; aborting it tears down the upstream
   *  socket inside the documented < 500 ms SLA. Mid-stream cancel
   *  yields a terminal `{ type: 'done', stopReason: { kind: 'cancelled' }}`
   *  event; pre-flight cancel yields the same shape (the binding
   *  synthesises it). */
  signal?: AbortSignal;
}

// ─── AQUI VIVIA EL PUENTE A RUST ───────────────────────────────────────────
//
// Este fichero era la envoltura TypeScript del binding napi-rs
// `@openlen/ai-gateway`: una clase `GeminiProvider` de ~200 lineas sobre el
// transporte SSE de Gemini escrito en Rust, mas `estimateTokens`.
//
// El 2026-08-28 salio Gemini del repo y con el la clase. Lo unico que quedaba
// bajando al crate era `estimateTokens`, y resulto que NO LO LLAMABA NADIE —
// se exportaba y nada mas. O sea que 3.497 lineas de Rust, un binding napi y
// un `.node` que el despliegue reconstruye en la caja existian para servir
// `Math.ceil(chars / 4)`, muerto.
//
// El crate entero se borro. Este fichero se queda como lo que de verdad es
// hoy: los TIPOS del protocolo de streaming —`Message`, `InlineImage`,
// `StreamEvent`, `StreamRequest`— y `GatewayError`. Los adaptadores de
// Fireworks los hablan, asi que el contrato sigue vivo aunque el transporte
// que lo estreno ya no este.
//
// Si vuelve a hacer falta estimar tokens antes de llamar: eran cuatro lineas,
// y `[...texto].length` (escalares Unicode) en vez de `.length` (unidades
// UTF-16) era la unica sutileza — un emoji contaba doble.
