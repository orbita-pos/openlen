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

import {
  GeminiProvider as RustGeminiProvider,
  type GeminiStream as RustGeminiStream,
  estimateTokens as rustEstimateTokens,
  type Message as RustMessage,
  type StopReason as RustStopReason,
  type StreamEvent as RustStreamEvent,
  type StreamRequest as RustStreamRequest,
} from "@openlen/ai-gateway";

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
  /** Gemini 2.5 thinking budget. `0` disables thinking for deterministic,
   *  bounded structured-output calls; `-1` keeps provider-dynamic thinking. */
  thinkingBudget?: number;
  /** Range 0.0–2.0; passed verbatim to Gemini. */
  temperature?: number;
  /** Reference images attached to the LAST user message. Empty/omitted for
   *  the text-only path. */
  images?: InlineImage[];
  /** Structured output (Quality S3). Set to `"application/json"` to force
   *  Gemini into JSON mode. Omitted = free-form text (unchanged path). */
  responseMimeType?: string;
  /** Gemini-subset OpenAPI response schema constraining the JSON output. Sent
   *  verbatim as `generationConfig.responseSchema`. Use UPPERCASE `type`
   *  values ("OBJECT", "STRING", "INTEGER", "ARRAY", "BOOLEAN") per the native
   *  Gemini Schema enum. The wrapper `JSON.stringify`s this across the napi
   *  boundary; only meaningful alongside `responseMimeType:
   *  "application/json"`. */
  responseSchema?: Record<string, unknown>;
  /** Function declarations (Gemini-subset schema, type en MAYÚSCULAS).
   *  El wrapper las envuelve en `[{ functionDeclarations: [...] }]`. */
  tools?: Record<string, unknown>[];
  /** AUTO deja decidir al modelo; ANY fuerza tool call; NONE las apaga. */
  toolMode?: "auto" | "any" | "none";
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

// ─── Free functions ────────────────────────────────────────────────────────

/** Coarse `chars / 4` token estimator for pre-flight credit checks.
 *  Cheap; intentionally over-estimates so the gate fails closed. Exact
 *  counts arrive in the `usage` stream event mid-stream. */
export function estimateTokens(text: string): number {
  return rustEstimateTokens(text);
}

// ─── Provider class ────────────────────────────────────────────────────────

export class GeminiProvider {
  private readonly inner: RustGeminiProvider;

  constructor(apiKey: string, baseUrl?: string) {
    this.inner = new RustGeminiProvider(apiKey, baseUrl);
  }

  estimateInputTokens(messages: Message[]): number {
    return this.inner.estimateInputTokens(messages.map(messageToRust));
  }

  /** Open a streaming generation. Returns an async iterator — consume
   *  with `for await (const event of stream)`. Cancel by aborting
   *  `opts.signal`, or by `break`ing out of the loop (the iterator's
   *  `return()` triggers an internal `cancel()`).
   *
   *  Errors:
   *  - Stream-level failures (mid-flight network drop, malformed SSE,
   *    upstream 5xx, auth failure on initial POST) throw a typed
   *    {@link GatewayError} inside the for-await loop.
   *  - Cancellation NEVER throws — see {@link StreamOptions.signal}.
   */
  stream(
    request: StreamRequest,
    opts: StreamOptions = {},
  ): AsyncIterableIterator<StreamEvent> {
    const inner = this.inner.stream(streamRequestToRust(request));
    if (opts.signal) {
      if (opts.signal.aborted) {
        inner.cancel();
      } else {
        opts.signal.addEventListener("abort", () => inner.cancel(), {
          once: true,
        });
      }
    }
    return iterate(inner);
  }
}

// ─── Internal: AsyncIterator over the Rust stream ──────────────────────────

async function* iterate(
  inner: RustGeminiStream,
): AsyncIterableIterator<StreamEvent> {
  try {
    while (true) {
      let raw: RustStreamEvent | null;
      try {
        raw = await inner.next();
      } catch (rawErr) {
        throw rehydrateError(rawErr);
      }
      if (raw === null) return;
      yield narrowEvent(raw);
    }
  } finally {
    // Caller broke out of the loop early (or threw); ensure the
    // upstream socket is torn down.
    inner.cancel();
  }
}

// ─── Internal: shape conversions ───────────────────────────────────────────

function messageToRust(m: Message): RustMessage {
  return {
    role: m.role,
    content: m.content,
    functionCallsJson: m.functionCalls ? JSON.stringify(m.functionCalls) : undefined,
    functionResponsesJson: m.functionResponses
      ? JSON.stringify(m.functionResponses)
      : undefined,
  };
}

function streamRequestToRust(r: StreamRequest): RustStreamRequest {
  return {
    model: r.model,
    messages: r.messages.map(messageToRust),
    maxOutputTokens: r.maxOutputTokens,
    thinkingBudget: r.thinkingBudget,
    temperature: r.temperature,
    images: r.images,
    responseMimeType: r.responseMimeType,
    // The napi layer takes the schema as a JSON string (no serde_json::Value
    // bridge in the crate's feature set) and parses it back to a Value.
    responseSchemaJson: r.responseSchema
      ? JSON.stringify(r.responseSchema)
      : undefined,
    toolsJson: r.tools
      ? JSON.stringify([{ functionDeclarations: r.tools }])
      : undefined,
    toolConfigJson: r.toolMode
      ? JSON.stringify({
          functionCallingConfig: { mode: r.toolMode.toUpperCase() },
        })
      : undefined,
  };
}

function narrowEvent(raw: RustStreamEvent): StreamEvent {
  switch (raw.type) {
    case "start":
      return { type: "start", id: raw.id as string };
    case "text_delta":
      return { type: "text_delta", text: raw.text as string };
    case "usage":
      return {
        type: "usage",
        inputTokens: raw.inputTokens as number,
        outputTokens: raw.outputTokens as number,
        cachedTokens: raw.cachedTokens ?? 0,
        thinkingTokens: raw.thinkingTokens ?? 0,
      };
    case "done":
      return {
        type: "done",
        stopReason: narrowStopReason(raw.stopReason as RustStopReason),
      };
    case "function_call": {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(raw.argsJson as string) as Record<string, unknown>;
      } catch {
        /* args malformados → objeto vacío; el tool runner responde error */
      }
      return {
        type: "function_call",
        name: raw.name as string,
        args,
        thoughtSignature: raw.thoughtSignature ?? undefined,
      };
    }
    default:
      throw new Error(
        `@openlen/ai-gateway: unexpected stream event type "${raw.type}"`,
      );
  }
}

function narrowStopReason(raw: RustStopReason): StopReason {
  switch (raw.kind) {
    case "end_turn":
      return { kind: "end_turn" };
    case "max_tokens":
      return { kind: "max_tokens" };
    case "cancelled":
      return { kind: "cancelled" };
    case "error":
      return { kind: "error", error: raw.error ?? "" };
    default:
      throw new Error(
        `@openlen/ai-gateway: unexpected stopReason kind "${raw.kind}"`,
      );
  }
}

// ─── Internal: napi Error envelope → typed GatewayError ────────────────────

interface GatewayEnvelope {
  kind: GatewayErrorKind;
  retryable: boolean;
  message: string;
  retryAfterMs?: number | null;
}

function rehydrateError(raw: unknown): Error {
  const envelope = tryParseEnvelope(raw);
  if (envelope) {
    return new GatewayError(
      envelope.kind,
      envelope.retryable,
      envelope.message,
      envelope.retryAfterMs ?? undefined,
    );
  }
  return raw instanceof Error ? raw : new Error(String(raw));
}

function tryParseEnvelope(raw: unknown): GatewayEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const message = (raw as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const kind = (parsed as { kind?: unknown }).kind;
  const retryable = (parsed as { retryable?: unknown }).retryable;
  const msg = (parsed as { message?: unknown }).message;
  if (typeof kind !== "string" || typeof retryable !== "boolean") return null;
  return {
    kind: kind as GatewayErrorKind,
    retryable,
    message: typeof msg === "string" ? msg : "",
    retryAfterMs: optionalNumber(
      (parsed as { retryAfterMs?: unknown }).retryAfterMs,
    ),
  };
}

function optionalNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
