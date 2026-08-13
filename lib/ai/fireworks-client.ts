import {
  fireworksJsonSchema,
  type FableModelRole,
  type FireworksJsonRequest,
  type FireworksJsonResult,
} from "./fireworks-contracts";
import { modelIdForRole, reasoningEffortAllowed } from "../generation/fable-model-policy";
import type { ModelTokenUsage } from "../generation/model-cost";
import type { PageBudget } from "../generation/page-generation-budget";

const FIREWORKS_ENDPOINT = "https://api.fireworks.ai/inference/v1/chat/completions";
const RETRYABLE_EMPTY_STATUS = new Set([429, 502, 503, 504]);
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type Environment = Readonly<Record<string, string | undefined>>;
type FailureCode = Extract<FireworksJsonResult<never>, { ok: false }>["code"];

export interface FireworksJsonClient {
  request<T>(request: FireworksJsonRequest<T>): Promise<FireworksJsonResult<T>>;
}

export interface FireworksJsonClientOptions {
  apiKey?: string;
  env?: Environment;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  budget: PageBudget;
  modelIds?: Partial<Record<FableModelRole, string>>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeToken(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function providerUsage(value: unknown): ModelTokenUsage | undefined {
  const root = record(value);
  const usage = record(root?.usage);
  const promptDetails = record(usage?.prompt_tokens_details);
  const completionDetailsValue = usage?.completion_tokens_details;
  const completionDetails = completionDetailsValue === undefined ? null : record(completionDetailsValue);
  if (!usage || !promptDetails || (completionDetailsValue !== undefined && !completionDetails)) return undefined;
  const inputTokens = safeToken(usage.prompt_tokens);
  const outputTokens = safeToken(usage.completion_tokens);
  const totalTokens = safeToken(usage.total_tokens);
  const cachedTokens = safeToken(promptDetails.cached_tokens);
  const reasoningValue = completionDetails?.reasoning_tokens;
  const thinkingTokens = reasoningValue === undefined ? 0 : safeToken(reasoningValue);
  if (inputTokens === null
    || outputTokens === null
    || totalTokens === null
    || cachedTokens === null
    || thinkingTokens === null
    || !Number.isSafeInteger(inputTokens + outputTokens)
    || totalTokens !== inputTokens + outputTokens
    || cachedTokens > inputTokens
    || thinkingTokens > outputTokens) return undefined;
  return { inputTokens, cachedTokens, outputTokens, thinkingTokens };
}

function responseContent(value: unknown): string | null {
  const root = record(value);
  if (!root || !Array.isArray(root.choices) || root.choices.length !== 1) return null;
  const choice = record(root.choices[0]);
  const message = record(choice?.message);
  if (!choice || choice.finish_reason !== "stop" || !message || typeof message.content !== "string") return null;
  return message.content;
}

function elapsed(started: number, now: () => number): number {
  return Math.max(0, Math.floor(now() - started));
}

function selectedModel(options: FireworksJsonClientOptions, role: FableModelRole): string | null {
  const approved = modelIdForRole(role);
  const candidate = (options.modelIds?.[role] ?? approved).trim();
  return candidate === approved ? candidate : null;
}

function validRequest<T>(request: FireworksJsonRequest<T>): boolean {
  return Array.isArray(request.messages)
    && request.messages.length > 0
    && request.messages.every((message) => (message.role === "system" || message.role === "user") && typeof message.content === "string")
    && Number.isSafeInteger(request.maxOutputTokens)
    && request.maxOutputTokens > 0
    && REQUEST_ID.test(request.requestId)
    && reasoningEffortAllowed(request.role, request.reasoningEffort);
}

function connectionTimeout(error: unknown): boolean {
  const outer = record(error);
  const cause = record(outer?.cause);
  const code = cause?.code ?? outer?.code;
  return code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT";
}

export function createFireworksJsonClient(options: FireworksJsonClientOptions): FireworksJsonClient {
  if (!options?.budget) throw new Error("page budget is required");
  const env = options.env ?? process.env;
  const apiKey = (options.apiKey ?? env.FIREWORKS_API_KEY)?.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? Math.floor(Number(options.timeoutMs))
    : 30_000;

  return {
    async request<T>(request: FireworksJsonRequest<T>): Promise<FireworksJsonResult<T>> {
      const started = now();
      const modelId = selectedModel(options, request.role) ?? modelIdForRole(request.role);
      const fail = (code: FailureCode, attempts: 0 | 1 | 2, usage?: ModelTokenUsage): FireworksJsonResult<T> => ({
        ok: false,
        code,
        modelId,
        ...(usage ? { usage } : {}),
        durationMs: elapsed(started, now),
        attempts,
      });

      if (!apiKey) return fail("missing_key", 0);
      if (selectedModel(options, request.role) === null || !validRequest(request)) return fail("provider", 0);

      let strictSchema: Record<string, unknown>;
      try { strictSchema = fireworksJsonSchema(request.responseSchema); } catch { return fail("schema", 0); }

      const payload = JSON.stringify({
        model: modelId,
        messages: request.messages,
        max_tokens: request.maxOutputTokens,
        reasoning_effort: request.reasoningEffort,
        temperature: 0,
        user: request.requestId,
        response_format: {
          type: "json_schema",
          json_schema: { name: "openlen_fable_response", strict: true, schema: strictSchema },
        },
      });
      const maxInputTokens = new TextEncoder().encode(payload).length;

      for (const attempt of [1, 2] as const) {
        const lease = options.budget.reserve({ kind: "model", modelId, maxInputTokens, maxOutputTokens: request.maxOutputTokens });
        if (!lease.ok) return fail("budget_exceeded", (attempt - 1) as 0 | 1);

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
        let body = "";
        let safeUsage: ModelTokenUsage | undefined;
        let responseReceived = false;
        let leaseSettled = false;

        const settleBudget = (usage: ModelTokenUsage | undefined): boolean => {
          if (leaseSettled) return true;
          leaseSettled = true;
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
          responseReceived = true;
          body = await Promise.race([response.text(), deadline]);
          let decodedEnvelope: unknown;
          if (body.length > 0) {
            try { decodedEnvelope = JSON.parse(body); } catch { decodedEnvelope = undefined; }
          }
          safeUsage = providerUsage(decodedEnvelope);
          if (!settleBudget(safeUsage)) return fail("budget_exceeded", attempt, safeUsage);

          if (!response.ok) {
            if (attempt === 1 && RETRYABLE_EMPTY_STATUS.has(response.status) && body.length === 0 && safeUsage === undefined) continue;
            return fail("http", attempt, safeUsage);
          }
          if (body.length === 0 || decodedEnvelope === undefined || !safeUsage) return fail("provider", attempt);
          const content = responseContent(decodedEnvelope);
          if (content === null) return fail("provider", attempt, safeUsage);
          let decodedContent: unknown;
          try { decodedContent = JSON.parse(content); } catch { return fail("invalid_json", attempt, safeUsage); }
          const parsed = request.responseSchema.safeParse(decodedContent);
          if (!parsed.success) return fail("schema", attempt, safeUsage);
          return { ok: true, value: parsed.data, modelId, usage: safeUsage, durationMs: elapsed(started, now), attempts: attempt };
        } catch (error) {
          settleBudget(safeUsage);
          const isTimeout = timedOut || connectionTimeout(error);
          if (isTimeout && !responseReceived && attempt === 1 && body.length === 0 && safeUsage === undefined) continue;
          return fail(isTimeout ? "timeout" : "provider", attempt, safeUsage);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }
      return fail("provider", 2);
    },
  };
}
