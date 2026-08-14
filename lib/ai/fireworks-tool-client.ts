import { CreativePatchSchema } from "../curate/creative-sandbox-contracts";
import { modelIdForRole } from "../generation/fable-model-policy";
import type { ModelTokenUsage } from "../generation/model-cost";
import type { PageBudget } from "../generation/page-generation-budget";
import {
  fireworksJsonSchema,
  type CreativeToolName,
  type FireworksProviderToolCall,
  type FireworksToolCall,
  type FireworksToolMessage,
  type FireworksToolTurnRequest,
  type FireworksToolTurnResult,
} from "./fireworks-contracts";
import { decodeFireworksUsage, DEFAULT_FIREWORKS_TIMEOUT_MS } from "./fireworks-client";

const FIREWORKS_ENDPOINT = "https://api.fireworks.ai/inference/v1/chat/completions";
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TOOL_CALL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TOOL_NAMES = new Set<CreativeToolName>(["inspect_canvas", "apply_creative_patch", "request_image", "render_preview"]);

type Environment = Readonly<Record<string, string | undefined>>;
type FailureCode = Extract<FireworksToolTurnResult, { ok: false }>["code"];

export interface FireworksToolClient {
  turn(request: FireworksToolTurnRequest): Promise<FireworksToolTurnResult>;
}

export interface FireworksToolClientOptions {
  readonly apiKey?: string;
  readonly env?: Environment;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly budget: PageBudget;
}

const emptyParameters = { type: "object", properties: {}, required: [], additionalProperties: false } as const;

export const CREATIVE_TOOL_DEFINITIONS = Object.freeze([
  {
    type: "function",
    function: { name: "inspect_canvas", description: "Inspect stable editable canvas targets.", parameters: emptyParameters },
  },
  {
    type: "function",
    function: {
      name: "apply_creative_patch",
      description: "Apply a bounded transactional HTML/CSS patch to the canvas.",
      parameters: fireworksJsonSchema(CreativePatchSchema),
    },
  },
  {
    type: "function",
    function: {
      name: "request_image",
      description: "Request one image asset for later validated use.",
      parameters: {
        type: "object",
        properties: { prompt: { type: "string", minLength: 1, maxLength: 2_000 } },
        required: ["prompt"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: { name: "render_preview", description: "Render and validate the current canvas.", parameters: emptyParameters },
  },
] as const);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function validProviderToolCall(value: unknown): value is FireworksProviderToolCall {
  const call = record(value);
  const fn = record(call?.function);
  return !!call
    && hasOnlyKeys(call, ["function", "id", "type"])
    && typeof call.id === "string"
    && TOOL_CALL_ID.test(call.id)
    && call.type === "function"
    && !!fn
    && hasOnlyKeys(fn, ["arguments", "name"])
    && typeof fn.name === "string"
    && typeof fn.arguments === "string";
}

function validMessage(message: FireworksToolMessage): boolean {
  const value = record(message);
  if (!value) return false;
  if ((value.role === "system" || value.role === "user") && typeof value.content === "string") {
    return hasOnlyKeys(value, ["content", "role"]);
  }
  if (value.role === "tool") {
    return hasOnlyKeys(value, ["content", "role", "tool_call_id"])
      && typeof value.tool_call_id === "string"
      && TOOL_CALL_ID.test(value.tool_call_id)
      && typeof value.content === "string";
  }
  if (value.role !== "assistant") return false;
  const keys = ["content", "role"];
  if (value.reasoning_content !== undefined) keys.push("reasoning_content");
  if (value.tool_calls !== undefined) keys.push("tool_calls");
  return hasOnlyKeys(value, keys)
    && (typeof value.content === "string" || value.content === null)
    && (value.reasoning_content === undefined || typeof value.reasoning_content === "string")
    && (value.tool_calls === undefined || (Array.isArray(value.tool_calls) && value.tool_calls.every(validProviderToolCall)));
}

function validRequest(request: FireworksToolTurnRequest): boolean {
  return Array.isArray(request.messages)
    && request.messages.length > 0
    && request.messages.every(validMessage)
    && Number.isSafeInteger(request.maxOutputTokens)
    && request.maxOutputTokens > 0
    && REQUEST_ID.test(request.requestId);
}

function decodeCalls(values: unknown): FireworksToolCall[] | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const calls: FireworksToolCall[] = [];
  const ids = new Set<string>();
  for (const value of values) {
    if (!validProviderToolCall(value) || ids.has(value.id) || !TOOL_NAMES.has(value.function.name as CreativeToolName)) return null;
    let args: unknown;
    try { args = JSON.parse(value.function.arguments); } catch { return null; }
    const argumentRecord = record(args);
    if (!argumentRecord) return null;
    const name = value.function.name as CreativeToolName;
    if ((name === "inspect_canvas" || name === "render_preview") && Object.keys(argumentRecord).length !== 0) return null;
    if (name === "request_image" && (!hasOnlyKeys(argumentRecord, ["prompt"])
      || typeof argumentRecord.prompt !== "string"
      || argumentRecord.prompt.length < 1
      || argumentRecord.prompt.length > 2_000)) return null;
    if (name === "apply_creative_patch" && !CreativePatchSchema.safeParse(argumentRecord).success) return null;
    ids.add(value.id);
    calls.push({ id: value.id, name, arguments: args });
  }
  return calls;
}

function decodeTurn(value: unknown): { calls: FireworksToolCall[]; content: string | null } | null {
  const root = record(value);
  if (!root || !Array.isArray(root.choices) || root.choices.length !== 1) return null;
  const choice = record(root.choices[0]);
  const message = record(choice?.message);
  if (!choice || !message || message.role !== "assistant" || !Object.prototype.hasOwnProperty.call(message, "content")) return null;
  const content = message.content;
  if (typeof content !== "string" && content !== null) return null;
  const rawCalls = message.tool_calls;
  if (choice.finish_reason === "tool_calls") {
    const calls = decodeCalls(rawCalls);
    return calls ? { calls, content } : null;
  }
  if (choice.finish_reason !== "stop") return null;
  if (rawCalls !== undefined && (!Array.isArray(rawCalls) || rawCalls.length > 0)) return null;
  return typeof content === "string" && content.length > 0 ? { calls: [], content } : null;
}

function elapsed(started: number, now: () => number): number {
  return Math.max(0, Math.floor(now() - started));
}

function connectionTimeout(error: unknown): boolean {
  const outer = record(error);
  const cause = record(outer?.cause);
  const code = cause?.code ?? outer?.code;
  return code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT";
}

export function createFireworksToolClient(options: FireworksToolClientOptions): FireworksToolClient {
  if (!options?.budget) throw new Error("page budget is required");
  const env = options.env ?? process.env;
  const apiKey = (options.apiKey ?? env.FIREWORKS_API_KEY)?.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? Math.floor(Number(options.timeoutMs))
    : DEFAULT_FIREWORKS_TIMEOUT_MS;
  const modelId = modelIdForRole("reasoner");

  return {
    async turn(request): Promise<FireworksToolTurnResult> {
      const started = now();
      const fail = (code: FailureCode, usage?: ModelTokenUsage): FireworksToolTurnResult => ({
        ok: false,
        code,
        ...(usage ? { usage } : {}),
        durationMs: elapsed(started, now),
        modelId,
      });
      if (!apiKey) return fail("missing_key");
      if (!validRequest(request)) return fail("provider");

      const payload = JSON.stringify({
        model: modelId,
        messages: request.messages,
        tools: CREATIVE_TOOL_DEFINITIONS,
        tool_choice: "auto",
        reasoning_effort: "high",
        reasoning_history: "interleaved",
        temperature: 0.2,
        max_tokens: request.maxOutputTokens,
        user: request.requestId,
      });
      const lease = options.budget.reserve({
        kind: "model",
        modelId,
        maxInputTokens: new TextEncoder().encode(payload).length,
        maxOutputTokens: request.maxOutputTokens,
      });
      if (!lease.ok) return fail("budget_exceeded");

      const controller = new AbortController();
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error("fireworks_timeout"));
        }, timeoutMs);
      });
      let usage: ModelTokenUsage | undefined;
      let settled = false;
      const settle = (): boolean => {
        if (settled) return true;
        settled = true;
        try {
          options.budget.complete(lease.leaseId, usage ?? ({} as ModelTokenUsage));
          return true;
        } catch {
          return usage === undefined;
        }
      };

      try {
        const response = await Promise.race([
          fetchImpl(FIREWORKS_ENDPOINT, {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: payload,
            signal: controller.signal,
          }),
          deadline,
        ]);
        let decoded: unknown;
        if (response.ok) {
          decoded = await Promise.race([response.json(), deadline]);
        } else {
          const body = await Promise.race([response.text(), deadline]);
          try { decoded = body.length > 0 ? JSON.parse(body) : undefined; } catch { decoded = undefined; }
        }
        usage = decodeFireworksUsage(decoded);
        if (!settle()) return fail("budget_exceeded", usage);
        if (!response.ok) return fail("http", usage);
        if (!usage) return fail("provider");
        const turn = decodeTurn(decoded);
        if (!turn) return fail("invalid_tool_call", usage);
        return { ok: true, ...turn, usage, durationMs: elapsed(started, now), modelId };
      } catch (error) {
        settle();
        return fail(timedOut || connectionTimeout(error) ? "timeout" : "provider", usage);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
