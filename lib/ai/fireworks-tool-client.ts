import { modelIdForRole } from "../generation/fable-model-policy";
import type { ModelTokenUsage } from "../generation/model-cost";
import type { PageBudget } from "../generation/page-generation-budget";
import { providerUsage } from "./fireworks-client";
import type { FireworksProviderCategory } from "./fireworks-contracts";

const FIREWORKS_ENDPOINT = "https://api.fireworks.ai/inference/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 180_000;
// A deadline that cannot cover the ceiling makes a paid turn a guaranteed
// write-off: nothing is streamed, so a turn that spends its whole allowance
// returns nothing at all until it is finished. A 180s deadline over a 24,000
// token ceiling aborted a design turn that was working normally.
// Measured since, on real design turns: 24,000 tokens in 172.5s and 31,396 in
// 221.5s -- 139 and 142 tokens per second. The floor keeps a 30% margin under
// the slower of the two.
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
        options.budget.complete(lease.leaseId, { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 });
        return fail(timedOut ? "timeout" : "http");
      }
      let envelope: unknown;
      try { envelope = await response.json(); } catch { envelope = null; } finally { clearTimeout(timer); }

      const usage = providerUsage(envelope);
      const settle = () => options.budget.complete(
        lease.leaseId,
        usage ?? { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 },
      );

      if (!response.ok) { settle(); return fail("http", { ...(usage ? { usage } : {}), httpStatus: response.status }); }

      const choice = record((record(envelope)?.choices as unknown[] | undefined)?.[0]);
      const message = record(choice?.message);
      if (!choice || !message) { settle(); return fail("provider", { ...(usage ? { usage } : {}), providerCategory: "response_content" }); }
      if (!usage) { settle(); return fail("provider", { providerCategory: "response_usage" }); }

      // finish_reason "length" means the ceiling ended the turn, whichever
      // shape the remains take: no call at all when the model was still
      // reasoning, or a call cut mid-JSON when it had started writing. Both are
      // truncation, and reporting the second as a malformed call hid a ceiling
      // the session was ready to raise.
      const truncated = choice.finish_reason === "length";
      const calls = readToolCalls(message);
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

      const content = message.content;
      const reasoning = message.reasoning_content;
      settle();
      return {
        ok: true,
        calls: calls.calls,
        content: typeof content === "string" ? content : null,
        reasoningContent: typeof reasoning === "string" ? reasoning : null,
        usage,
        durationMs: Math.max(0, Math.floor(now() - started)),
        modelId,
      };
    },
  };
}
