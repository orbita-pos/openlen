// Transporte de texto en streaming contra Fireworks.
//
// El cliente JSON valida una respuesta completa contra un esquema y el cliente
// de herramientas arma el turno entero antes de devolverlo: ninguno de los dos
// deja ver los tokens según llegan. El Chat SÍ los necesita —el usuario ve la
// página armarse— así que este módulo hace lo único que faltaba: leer el mismo
// SSE compatible con OpenAI y CEDER cada trozo.
//
// Los eventos tienen a propósito la forma que ya consume la ruta del Chat
// (`text_delta` / `usage` / `done`), para que cambiar de proveedor no obligue a
// reescribir cómo se sirve el stream al navegador. Lo único nuevo es
// `reasoning_delta`: DeepSeek manda su pensamiento por un canal aparte
// (`delta.reasoning_content`) en vez de mezclarlo con la respuesta.

import {
  modelIdForRole,
  reasoningEffortFor,
  roleForOperation,
  type FableModelOperation,
} from "../generation/fable-model-policy";
import { providerUsage } from "./fireworks-client";

const FIREWORKS_ENDPOINT = "https://api.fireworks.ai/inference/v1/chat/completions";

export type FireworksStreamEvent =
  | { readonly type: "reasoning_delta"; readonly text: string }
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "usage"; readonly inputTokens: number; readonly outputTokens: number; readonly cachedTokens: number; readonly thinkingTokens: number }
  // Las llamadas a herramienta llegan partidas —el id y el nombre una vez, los
  // argumentos de a pocos caracteres, y ordenadas por índice, nunca por orden de
  // llegada—, así que se ceden ARMADAS al cerrar el turno. El texto sigue
  // saliendo en vivo: el modelo narra primero y actúa después, que es justo lo
  // que hace sentir vivo al Agente.
  | { readonly type: "function_call"; readonly name: string; readonly args: Record<string, unknown> }
  // Misma forma discriminada que el transporte de Gemini, para que el consumidor
  // los lea con el mismo `switch` y ninguno de los dos necesite un adaptador.
  | { readonly type: "done"; readonly stopReason: FireworksStopReason };

export type FireworksStopReason =
  | { readonly kind: "end_turn" }
  | { readonly kind: "max_tokens" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "error"; readonly error: string };

export interface FireworksStreamToolCall {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
}

export interface FireworksStreamMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  /** Turno de herramienta: a qué llamada responde. */
  readonly toolCallId?: string;
  /** Turno del asistente: las llamadas que emitió, para poder repetirlo. */
  readonly toolCalls?: readonly FireworksStreamToolCall[];
}

export interface FireworksStreamRequest {
  readonly messages: readonly FireworksStreamMessage[];
  readonly maxOutputTokens: number;
  readonly temperature: number;
  readonly requestId: string;
  /** El TRABAJO, no el modelo: la política elige ambos. */
  readonly operation: FableModelOperation;
  /** Declaraciones en formato OpenAI. Sin herramientas el turno es sólo texto. */
  readonly tools?: readonly Record<string, unknown>[];
}

export interface FireworksStreamClientOptions {
  readonly apiKey?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof fetch;
  readonly endpoint?: string;
}

export interface FireworksStreamClient {
  readonly modelId: string;
  stream(request: FireworksStreamRequest, opts?: { signal?: AbortSignal }): AsyncIterableIterator<FireworksStreamEvent>;
}

function wireMessage(message: FireworksStreamMessage): Record<string, unknown> {
  if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  if (message.role !== "assistant") return { role: message.role, content: message.content };
  return {
    role: "assistant",
    content: message.content,
    ...(message.toolCalls?.length
      ? {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.argumentsJson },
          })),
        }
      : {}),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** `length` es truncamiento, y la ruta ya sabe distinguirlo de un final limpio.
 *  Un stream que terminó sin nombrar jamás su razón NO terminó: decir que sí
 *  entrega media página como si estuviera completa. */
function stopReasonFor(finishReason: string | null): FireworksStopReason {
  if (finishReason === "length") return { kind: "max_tokens" };
  // `tool_calls` es un final limpio: el modelo cerró el turno para que alguien
  // ejecute algo. Tratarlo como error mataría el Agente en su primera acción.
  if (finishReason) return { kind: "end_turn" };
  return { kind: "error", error: "stream ended without a finish reason" };
}

export function createFireworksStreamClient(options: FireworksStreamClientOptions = {}): FireworksStreamClient {
  const env = options.env ?? process.env;
  const apiKey = (options.apiKey ?? env.FIREWORKS_API_KEY)?.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? FIREWORKS_ENDPOINT;

  return {
    modelId: modelIdForRole("reasoner"),

    async *stream(request, opts = {}) {
      if (!apiKey) {
        yield { type: "done", stopReason: { kind: "error", error: "missing_key" } };
        return;
      }
      const role = roleForOperation(request.operation);

      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: modelIdForRole(role),
            messages: request.messages.map(wireMessage),
            ...(request.tools?.length ? { tools: request.tools, tool_choice: "auto" } : {}),
            reasoning_effort: reasoningEffortFor(role, request.operation),
            temperature: request.temperature,
            max_tokens: request.maxOutputTokens,
            user: request.requestId,
            stream: true,
            stream_options: { include_usage: true },
          }),
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
      } catch (error) {
        const aborted = opts.signal?.aborted === true;
        yield { type: "done", stopReason: aborted ? { kind: "cancelled" } : { kind: "error", error: String(error instanceof Error ? error.message : error) } };
        return;
      }

      if (!response.ok || !response.body) {
        // El cuerpo del error trae la razón real (clave inválida, modelo
        // desconocido, límite). Tirarlo deja "algo falló" y una hora perdida.
        let detail = `http_${response.status}`;
        try { detail = `${detail}: ${(await response.text()).slice(0, 300)}`; } catch { /* sin cuerpo */ }
        yield { type: "done", stopReason: { kind: "error", error: detail } };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let finishReason: string | null = null;
      let usageEnvelope: unknown = null;
      const pendingCalls = new Map<number, { id?: string; name?: string; args: string }>();
      let buffer = "";
      let cancelled = false;

      // Un generador puede abandonarse a media lectura (el consumidor hace
      // `break`): sin esto el socket de arriba se queda abierto.
      try {
        outer: for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice("data:".length).trim();
            if (data === "" || data === "[DONE]") continue;
            let parsed: unknown;
            try { parsed = JSON.parse(data); } catch { continue; }
            const root = record(parsed);
            if (!root) continue;
            if (record(root.usage)) usageEnvelope = root;
            const choice = record((root.choices as unknown[] | undefined)?.[0]);
            if (!choice) continue;
            if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
            const delta = record(choice.delta);
            if (!delta) continue;
            if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
              yield { type: "reasoning_delta", text: delta.reasoning_content };
            }
            if (typeof delta.content === "string" && delta.content.length > 0) {
              yield { type: "text_delta", text: delta.content };
            }
            for (const entry of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
              const call = record(entry);
              if (!call) continue;
              const index = typeof call.index === "number" && Number.isInteger(call.index) ? call.index : pendingCalls.size;
              const previous = pendingCalls.get(index) ?? { args: "" };
              const fn = record(call.function);
              pendingCalls.set(index, {
                ...(typeof call.id === "string" && call.id ? { id: call.id } : previous.id ? { id: previous.id } : {}),
                ...(typeof fn?.name === "string" && fn.name ? { name: fn.name } : previous.name ? { name: previous.name } : {}),
                args: previous.args + (typeof fn?.arguments === "string" ? fn.arguments : ""),
              });
            }
            if (opts.signal?.aborted) { cancelled = true; break outer; }
          }
        }
      } catch (error) {
        if (opts.signal?.aborted) cancelled = true;
        else {
          yield { type: "done", stopReason: { kind: "error", error: String(error instanceof Error ? error.message : error) } };
          return;
        }
      } finally {
        void reader.cancel().catch(() => undefined);
      }

      // Argumentos que no son JSON no son una llamada: ejecutarlos a medias es
      // peor que no ejecutarlos.
      for (const [, call] of [...pendingCalls.entries()].sort(([left], [right]) => left - right)) {
        if (!call.name) continue;
        let args: unknown;
        try { args = call.args.trim() === "" ? {} : JSON.parse(call.args); } catch {
          yield { type: "done", stopReason: { kind: "error", error: `tool arguments were not JSON: ${call.name}` } };
          return;
        }
        const parsed = record(args);
        if (!parsed) {
          yield { type: "done", stopReason: { kind: "error", error: `tool arguments were not an object: ${call.name}` } };
          return;
        }
        yield { type: "function_call", name: call.name, args: parsed };
      }

      const usage = providerUsage(usageEnvelope);
      if (usage) {
        yield {
          type: "usage",
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedTokens: usage.cachedTokens,
          thinkingTokens: usage.thinkingTokens,
        };
      }
      yield { type: "done", stopReason: cancelled ? { kind: "cancelled" } : stopReasonFor(finishReason) };
    },
  };
}
