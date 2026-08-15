import { modelIdForRole } from "../generation/fable-model-policy";
import type { ModelTokenUsage } from "../generation/model-cost";
import type { PageBudget } from "../generation/page-generation-budget";
import { providerUsage } from "./fireworks-client";
import type { FireworksProviderCategory } from "./fireworks-contracts";

const FIREWORKS_ENDPOINT = "https://api.fireworks.ai/inference/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 180_000;
// A deadline that cannot cover the ceiling makes a paid turn a guaranteed
// write-off. Measured on real design turns: 24,000 tokens in 172.5s and 31,396
// in 221.5s -- 139 and 142 tokens per second. The floor keeps a 30% margin
// under the slower of the two.
//
// This deadline is only reachable because the turn streams. Waiting for a whole
// completion put every design turn behind undici's 300s headers timeout, which
// is not ours to move: a 39,995-token turn died at 307s with nothing delivered
// while our own deadline still had 200s left to give.
const MIN_OUTPUT_TOKENS_PER_SECOND = 100;
const DEADLINE_BASE_MS = 30_000;

function deadlineForCeiling(maxOutputTokens: number): number {
  const covered = DEADLINE_BASE_MS + Math.ceil(maxOutputTokens / MIN_OUTPUT_TOKENS_PER_SECOND) * 1000;
  return Math.max(DEFAULT_TIMEOUT_MS, covered);
}

export type CreativeToolName = "inspect_canvas" | "apply_creative_patch" | "request_image" | "render_preview";

const TOOL_NAMES = new Set<string>(["inspect_canvas", "apply_creative_patch", "request_image", "render_preview"]);

// Op names are an explicit enum: a real turn emitted {"op":"replace"} when the
// schema left `op` a free string, which no patch validator would accept.
export const CREATIVE_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "inspect_canvas",
      description: "Return the current page outline, stable editable targets, bounded copy, image slots and diagnostics.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_creative_patch",
      description: "Apply bounded operations to the page. Section bodies may contain broad HTML and CSS.",
      parameters: {
        type: "object",
        properties: {
          operations: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              properties: {
                op: {
                  type: "string",
                  enum: ["replace_section", "insert_section", "remove_section", "move_section", "set_page_css", "set_link"],
                },
                targetId: { type: "string" },
                afterTargetId: { type: ["string", "null"] },
                role: { type: "string" },
                html: { type: "string" },
                css: { type: "string" },
                url: { type: "string" },
                label: { type: "string" },
              },
              required: ["op"],
            },
          },
        },
        required: ["operations"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_image",
      description: "Ask OpenLen for an optional image in a described slot. Failure leaves the page unchanged.",
      parameters: {
        type: "object",
        properties: {
          targetId: { type: "string" },
          subject: { type: "string" },
          mediaType: { type: "string", enum: ["photo", "illustration", "texture"] },
        },
        required: ["targetId", "subject"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "render_preview",
      description: "Render desktop and mobile diagnostics for the current page and return bounded measurements.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
] as const;

export interface FireworksToolCall {
  readonly id: string;
  readonly name: CreativeToolName;
  readonly arguments: unknown;
}

export type FireworksToolMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string;
      readonly reasoningContent?: string;
      readonly toolCalls?: readonly { readonly id: string; readonly name: CreativeToolName; readonly argumentsJson: string }[];
    }
  | { readonly role: "tool"; readonly toolCallId: string; readonly content: string };

export interface FireworksToolTurnRequest {
  readonly requestId: string;
  readonly maxOutputTokens: number;
  readonly messages: readonly FireworksToolMessage[];
}

export type FireworksToolTurnResult =
  | {
      readonly ok: true;
      readonly calls: readonly FireworksToolCall[];
      readonly content: string | null;
      readonly reasoningContent: string | null;
      readonly usage: ModelTokenUsage;
      readonly durationMs: number;
      readonly modelId: string;
    }
  | {
      readonly ok: false;
      readonly code: "missing_key" | "budget_exceeded" | "timeout" | "http" | "provider" | "invalid_tool_call";
      readonly usage?: ModelTokenUsage;
      readonly durationMs: number;
      readonly modelId: string;
      readonly providerCategory?: FireworksProviderCategory;
      readonly httpStatus?: number;
    };

export interface FireworksToolClient {
  turn(request: FireworksToolTurnRequest): Promise<FireworksToolTurnResult>;
}

export interface FireworksToolClientOptions {
  readonly budget: PageBudget;
  readonly apiKey?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function wireMessage(message: FireworksToolMessage): Record<string, unknown> {
  if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  if (message.role !== "assistant") return { role: message.role, content: message.content };
  return {
    role: "assistant",
    content: message.content,
    ...(message.reasoningContent ? { reasoning_content: message.reasoningContent } : {}),
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

/** Reads only the fields we rely on. Fireworks adds `tools` to the message and
 * `index`/`name` to each call; rejecting those would reject valid turns. */
function readToolCalls(message: Record<string, unknown>): { ok: true; calls: FireworksToolCall[] } | { ok: false } {
  const raw = message.tool_calls;
  if (raw === undefined || raw === null) return { ok: true, calls: [] };
  if (!Array.isArray(raw)) return { ok: false };
  const calls: FireworksToolCall[] = [];
  for (const entry of raw) {
    const call = record(entry);
    const fn = record(call?.function);
    const id = call?.id;
    const name = fn?.name;
    const args = fn?.arguments;
    if (typeof id !== "string" || id.length === 0 || typeof name !== "string" || !TOOL_NAMES.has(name)) return { ok: false };
    if (typeof args !== "string") return { ok: false };
    let parsed: unknown;
    try { parsed = args.trim() === "" ? {} : JSON.parse(args); } catch { return { ok: false }; }
    calls.push({ id, name: name as CreativeToolName, arguments: parsed });
  }
  return { ok: true, calls };
}

interface StreamedTurn {
  finishReason: string | null;
  content: string | null;
  reasoningContent: string | null;
  toolCalls: Record<string, unknown>[];
  /** The chunk that carried `usage`, kept whole so `providerUsage` reads it
   * exactly as it reads a non-streamed envelope. */
  usageEnvelope: unknown;
}

/** Rebuilds one turn from its deltas. Tool calls arrive split across chunks --
 * the id and name once, the arguments a few characters at a time -- and are
 * keyed by index, never by arrival order. */
async function assembleStreamedTurn(body: ReadableStream<Uint8Array> | null): Promise<StreamedTurn | null> {
  if (!body) return null;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, { id?: string; name?: string; args: string }>();
  let content: string | null = null;
  let reasoningContent: string | null = null;
  let finishReason: string | null = null;
  let usageEnvelope: unknown = null;

  const consume = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice("data:".length).trim();
    if (data === "" || data === "[DONE]") return;
    let parsed: unknown;
    try { parsed = JSON.parse(data); } catch { return; }
    const root = record(parsed);
    if (!root) return;
    if (record(root.usage)) usageEnvelope = root;
    const choice = record((root.choices as unknown[] | undefined)?.[0]);
    if (!choice) return;
    if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
    const delta = record(choice.delta);
    if (!delta) return;
    if (typeof delta.content === "string") content = (content ?? "") + delta.content;
    if (typeof delta.reasoning_content === "string") reasoningContent = (reasoningContent ?? "") + delta.reasoning_content;
    for (const entry of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const call = record(entry);
      if (!call) continue;
      const index = typeof call.index === "number" && Number.isInteger(call.index) ? call.index : calls.size;
      const previous = calls.get(index) ?? { args: "" };
      const fn = record(call.function);
      calls.set(index, {
        ...(typeof call.id === "string" && call.id ? { id: call.id } : previous.id ? { id: previous.id } : {}),
        ...(typeof fn?.name === "string" && fn.name ? { name: fn.name } : previous.name ? { name: previous.name } : {}),
        args: previous.args + (typeof fn?.arguments === "string" ? fn.arguments : ""),
      });
    }
  };

  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
      consume(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  consume(buffer);

  return {
    finishReason,
    content,
    reasoningContent,
    toolCalls: [...calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => ({ id: call.id ?? "", function: { name: call.name ?? "", arguments: call.args } })),
    usageEnvelope,
  };
}

export function createFireworksToolClient(options: FireworksToolClientOptions): FireworksToolClient {
  if (!options?.budget) throw new Error("page budget is required");
  const env = options.env ?? process.env;
  const apiKey = (options.apiKey ?? env.FIREWORKS_API_KEY)?.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const configuredTimeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? Math.floor(Number(options.timeoutMs))
    : null;

  return {
    async turn(request) {
      const started = now();
      const modelId = modelIdForRole("reasoner");
      const fail = (
        code: Extract<FireworksToolTurnResult, { ok: false }>["code"],
        extra: { usage?: ModelTokenUsage; providerCategory?: FireworksProviderCategory; httpStatus?: number } = {},
      ): FireworksToolTurnResult => ({
        ok: false,
        code,
        modelId,
        durationMs: Math.max(0, Math.floor(now() - started)),
        ...(extra.usage ? { usage: extra.usage } : {}),
        ...(extra.providerCategory ? { providerCategory: extra.providerCategory } : {}),
        ...(extra.httpStatus !== undefined ? { httpStatus: extra.httpStatus } : {}),
      });

      if (!apiKey) return fail("missing_key");

      const payload = JSON.stringify({
        model: modelId,
        messages: request.messages.map(wireMessage),
        tools: CREATIVE_TOOL_DEFINITIONS,
        tool_choice: "auto",
        reasoning_effort: "high",
        reasoning_history: "interleaved",
        temperature: 0.2,
        max_tokens: request.maxOutputTokens,
        user: request.requestId,
        stream: true,
        stream_options: { include_usage: true },
      });

      // Reserve once, call once, settle once. No automatic retry.
      const lease = options.budget.reserve({
        kind: "model",
        modelId,
        maxInputTokens: new TextEncoder().encode(payload).length,
        maxOutputTokens: request.maxOutputTokens,
      });
      if (!lease.ok) return fail("budget_exceeded");

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(
        () => { timedOut = true; controller.abort(); },
        configuredTimeoutMs ?? deadlineForCeiling(request.maxOutputTokens),
      );
      const settleUnused = () => options.budget.complete(
        lease.leaseId,
        { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 },
      );

      let response: Response;
      try {
        response = await fetchImpl(FIREWORKS_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: payload,
          signal: controller.signal,
        });
      } catch {
        clearTimeout(timer);
        settleUnused();
        return fail(timedOut ? "timeout" : "http");
      }
      if (!response.ok) {
        clearTimeout(timer);
        settleUnused();
        return fail("http", { httpStatus: response.status });
      }

      let streamed: StreamedTurn | null;
      try {
        streamed = await assembleStreamedTurn(response.body);
      } catch {
        settleUnused();
        return fail(timedOut ? "timeout" : "http");
      } finally {
        clearTimeout(timer);
      }

      const usage = providerUsage(streamed?.usageEnvelope);
      const settle = () => options.budget.complete(
        lease.leaseId,
        usage ?? { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 },
      );

      // A stream that ended without ever naming a finish reason did not finish.
      if (!streamed || streamed.finishReason === null) { settle(); return fail("provider", { ...(usage ? { usage } : {}), providerCategory: "response_content" }); }
      if (!usage) { settle(); return fail("provider", { providerCategory: "response_usage" }); }

      // finish_reason "length" means the ceiling ended the turn, whichever
      // shape the remains take: no call at all when the model was still
      // reasoning, or a call cut mid-JSON when it had started writing. Both are
      // truncation, and reporting the second as a malformed call hid a ceiling
      // the session was ready to raise.
      const truncated = streamed.finishReason === "length";
      const calls = readToolCalls({ tool_calls: streamed.toolCalls });
      if (!calls.ok) {
        settle();
        return truncated
          ? fail("provider", { usage, providerCategory: "response_truncated" })
          : fail("invalid_tool_call", { usage });
      }
      if (truncated && calls.calls.length === 0) {
        settle();
        return fail("provider", { usage, providerCategory: "response_truncated" });
      }

      settle();
      return {
        ok: true,
        calls: calls.calls,
        content: streamed.content,
        reasoningContent: streamed.reasoningContent,
        usage,
        durationMs: Math.max(0, Math.floor(now() - started)),
        modelId,
      };
    },
  };
}
