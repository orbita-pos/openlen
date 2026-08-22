import {
  fireworksJsonSchema,
  type FableModelRole,
  type FireworksJsonRequest,
  type FireworksJsonResult,
  type FireworksProviderCategory,
  type FireworksServiceTier,
} from "./fireworks-contracts";
import { modelIdForRole, reasoningEffortAllowed } from "../generation/fable-model-policy";
import { validateGeneratedImage } from "../generation/asset-image-validation";
import type { ModelTokenUsage } from "../generation/model-cost";
import type { PageBudget } from "../generation/page-generation-budget";

const FIREWORKS_ENDPOINT = "https://api.fireworks.ai/inference/v1/chat/completions";
export const DEFAULT_FIREWORKS_TIMEOUT_MS = 600_000;
const RETRYABLE_EMPTY_STATUS = new Set([429, 502, 503, 504]);
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const JPEG_DATA_URI_PREFIX = "data:image/jpeg;base64,";
const MAX_INLINE_JPEG_BYTES = 1024 * 1024;

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
  maxAttempts?: 1 | 2;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeToken(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function providerUsage(value: unknown): ModelTokenUsage | undefined {
  const root = record(value);
  const usage = record(root?.usage);
  const promptDetailsValue = usage?.prompt_tokens_details;
  const promptDetails = promptDetailsValue === undefined ? null : record(promptDetailsValue);
  const completionDetailsValue = usage?.completion_tokens_details;
  const completionDetails = completionDetailsValue === undefined ? null : record(completionDetailsValue);
  if (!usage
    || (promptDetailsValue !== undefined && !promptDetails)
    || (completionDetailsValue !== undefined && !completionDetails)) return undefined;
  const inputTokens = safeToken(usage.prompt_tokens);
  const totalTokens = safeToken(usage.total_tokens);
  const reportedOutputTokens = usage.completion_tokens === undefined ? undefined : safeToken(usage.completion_tokens);
  const outputTokens = reportedOutputTokens === undefined && inputTokens !== null && totalTokens !== null
    ? totalTokens - inputTokens
    : reportedOutputTokens;
  const cachedValue = promptDetails?.cached_tokens;
  const cachedTokens = cachedValue === undefined ? 0 : safeToken(cachedValue);
  const reasoningValue = completionDetails?.reasoning_tokens;
  const thinkingTokens = reasoningValue === undefined ? 0 : safeToken(reasoningValue);
  if (inputTokens === null
    || outputTokens === null
    || outputTokens === undefined
    || !Number.isSafeInteger(outputTokens)
    || outputTokens < 0
    || totalTokens === null
    || cachedTokens === null
    || thinkingTokens === null
    || !Number.isSafeInteger(inputTokens + outputTokens)
    || totalTokens !== inputTokens + outputTokens
    || cachedTokens > inputTokens
    || thinkingTokens > outputTokens) return undefined;
  return { inputTokens, cachedTokens, outputTokens, thinkingTokens };
}

function responseContent(value: unknown):
  | { ok: true; content: string; tokenBoundary: boolean }
  | { ok: false; category: FireworksProviderCategory } {
  const root = record(value);
  if (!root || !Array.isArray(root.choices) || root.choices.length !== 1) {
    return { ok: false, category: "response_envelope" };
  }
  const choice = record(root.choices[0]);
  const message = record(choice?.message);
  if (!choice || !message) return { ok: false, category: "response_envelope" };
  if (choice.finish_reason !== "stop" && choice.finish_reason !== "length") {
    return { ok: false, category: "response_envelope" };
  }
  if (typeof message.content !== "string" || message.content.length === 0) {
    return { ok: false, category: "response_content" };
  }
  return { ok: true, content: message.content, tokenBoundary: choice.finish_reason === "length" };
}

function jsonCandidates(content: string): unknown[] {
  try {
    return [JSON.parse(content)];
  } catch {
    // Some compatible providers wrap otherwise-valid structured JSON in prose
    // or a Markdown fence. Extract bounded top-level JSON values; the caller's
    // strict schema remains the authority and ambiguity is rejected.
  }
  const candidates: unknown[] = [];
  let start = -1;
  let stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (start < 0) {
      if (character === "{" || character === "[") {
        start = index;
        stack = [character];
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") stack.push(character);
    if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (stack.at(-1) !== expected) {
        start = -1;
        stack = [];
        continue;
      }
      stack.pop();
      if (stack.length === 0) {
        try {
          candidates.push(JSON.parse(content.slice(start, index + 1)));
        } catch {
          // Retain no provider bytes and continue looking for one valid value.
        }
        start = -1;
      }
    }
  }
  return candidates;
}

function elapsed(started: number, now: () => number): number {
  return Math.max(0, Math.floor(now() - started));
}

function selectedModel(options: FireworksJsonClientOptions, role: FableModelRole): string | null {
  const approved = modelIdForRole(role);
  const candidate = (options.modelIds?.[role] ?? approved).trim();
  return candidate === approved ? candidate : null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function validJpegDataUri(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(JPEG_DATA_URI_PREFIX)) return false;
  const encoded = value.slice(JPEG_DATA_URI_PREFIX.length);
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
  const bytes = Buffer.from(encoded, "base64");
  return bytes.length > 0 && bytes.length <= MAX_INLINE_JPEG_BYTES && bytes.toString("base64") === encoded;
}

function validMultimodalContent(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const textPart = record(value[0]);
  const imagePart = record(value[1]);
  const imageUrl = record(imagePart?.image_url);
  return !!textPart
    && hasOnlyKeys(textPart, ["text", "type"])
    && textPart.type === "text"
    && typeof textPart.text === "string"
    && !!imagePart
    && hasOnlyKeys(imagePart, ["image_url", "type"])
    && imagePart.type === "image_url"
    && !!imageUrl
    && hasOnlyKeys(imageUrl, ["url"])
    && validJpegDataUri(imageUrl.url);
}

function validRequest<T>(request: FireworksJsonRequest<T>): boolean {
  let imageCount = 0;
  return Array.isArray(request.messages)
    && request.messages.length > 0
    && request.messages.every((message) => {
      if (!message || (message.role !== "system" && message.role !== "user")) return false;
      if (typeof message.content === "string") return true;
      if (request.role !== "visual_critic" || message.role !== "user" || !validMultimodalContent(message.content)) return false;
      imageCount += 1;
      return imageCount <= 2;
    })
    && Number.isSafeInteger(request.maxOutputTokens)
    && request.maxOutputTokens > 0
    && REQUEST_ID.test(request.requestId)
    && (request.serviceTier === undefined || request.serviceTier === "standard" || request.serviceTier === "priority")
    && (request.maxAttempts === undefined || request.maxAttempts === 1 || request.maxAttempts === 2)
    && reasoningEffortAllowed(request.role, request.reasoningEffort);
}

function inlineJpegBytes<T>(request: FireworksJsonRequest<T>): Buffer[] {
  const images: Buffer[] = [];
  for (const message of request.messages) {
    if (!Array.isArray(message.content)) continue;
    const imagePart = record(message.content[1]);
    const imageUrl = record(imagePart?.image_url);
    if (typeof imageUrl?.url === "string" && imageUrl.url.startsWith(JPEG_DATA_URI_PREFIX)) {
      images.push(Buffer.from(imageUrl.url.slice(JPEG_DATA_URI_PREFIX.length), "base64"));
    }
  }
  return images;
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
    : DEFAULT_FIREWORKS_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts === 1 ? 1 : 2;

  return {
    async request<T>(request: FireworksJsonRequest<T>): Promise<FireworksJsonResult<T>> {
      const started = now();
      const modelId = selectedModel(options, request.role) ?? modelIdForRole(request.role);
      const serviceTier: FireworksServiceTier = request.serviceTier ?? "standard";
      const fail = (
        code: FailureCode,
        attempts: 0 | 1 | 2,
        usage?: ModelTokenUsage,
        diagnostics?: { providerCategory?: FireworksProviderCategory; httpStatus?: number },
      ): FireworksJsonResult<T> => ({
        ok: false,
        code,
        modelId,
        ...(usage ? { usage } : {}),
        ...(serviceTier === "priority" ? { serviceTier } : {}),
        ...(diagnostics?.providerCategory ? { providerCategory: diagnostics.providerCategory } : {}),
        ...(diagnostics?.httpStatus !== undefined ? { httpStatus: diagnostics.httpStatus } : {}),
        durationMs: elapsed(started, now),
        attempts,
      });

      if (!apiKey) return fail("missing_key", 0);
      if (selectedModel(options, request.role) === null || !validRequest(request)) return fail("provider", 0, undefined, { providerCategory: "request" });
      const jpegBytes = inlineJpegBytes(request);
      if (jpegBytes.length > 0) {
        try {
          for (const bytes of jpegBytes) await validateGeneratedImage(bytes, "image/jpeg");
        } catch { return fail("provider", 0, undefined, { providerCategory: "request" }); }
      }

      let strictSchema: Record<string, unknown>;
      try { strictSchema = fireworksJsonSchema(request.responseSchema); } catch { return fail("schema", 0, undefined, { providerCategory: "schema" }); }

      const payload = JSON.stringify({
        model: modelId,
        messages: request.messages,
        max_tokens: request.maxOutputTokens,
        reasoning_effort: request.reasoningEffort,
        temperature: 0,
        user: request.requestId,
        ...(serviceTier === "priority" ? { service_tier: "priority" } : {}),
        response_format: {
          type: "json_schema",
          json_schema: { name: "openlen_fable_response", strict: true, schema: strictSchema },
        },
      });
      const maxInputTokens = new TextEncoder().encode(payload).length;

      const requestMaxAttempts = Math.min(maxAttempts, request.maxAttempts ?? maxAttempts) as 1 | 2;
      for (const attempt of ([1, 2] as const).slice(0, requestMaxAttempts)) {
        const lease = options.budget.reserve({
          kind: "model",
          modelId,
          ...(serviceTier === "priority" ? { serviceTier } : {}),
          maxInputTokens,
          maxOutputTokens: request.maxOutputTokens,
        });
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
            if (attempt < requestMaxAttempts && RETRYABLE_EMPTY_STATUS.has(response.status) && body.length === 0 && safeUsage === undefined) continue;
            return fail("http", attempt, safeUsage, { providerCategory: "http", httpStatus: response.status });
          }
          if (body.length === 0 || decodedEnvelope === undefined) return fail("provider", attempt, undefined, { providerCategory: "response_envelope" });
          const content = responseContent(decodedEnvelope);
          if (!content.ok) return fail("provider", attempt, safeUsage, { providerCategory: content.category });
          if (!safeUsage) return fail("provider", attempt, undefined, { providerCategory: "response_usage" });
          const decodedCandidates = jsonCandidates(content.content);
          if (decodedCandidates.length === 0) {
            return fail("invalid_json", attempt, safeUsage, {
              providerCategory: content.tokenBoundary ? "response_truncated" : "response_content",
            });
          }
          const parsedCandidates = decodedCandidates
            .map((candidate) => request.responseSchema.safeParse(candidate))
            .filter((candidate): candidate is Extract<typeof candidate, { success: true }> => candidate.success);
          if (parsedCandidates.length !== 1) return fail("schema", attempt, safeUsage, { providerCategory: "schema" });
          return {
            ok: true,
            value: parsedCandidates[0].data,
            modelId,
            usage: safeUsage,
            durationMs: elapsed(started, now),
            attempts: attempt,
            ...(serviceTier === "priority" ? { serviceTier } : {}),
          };
        } catch (error) {
          settleBudget(safeUsage);
          const isTimeout = timedOut || connectionTimeout(error);
          if (isTimeout && !responseReceived && attempt < requestMaxAttempts && body.length === 0 && safeUsage === undefined) continue;
          return fail(
            isTimeout ? "timeout" : "provider",
            attempt,
            safeUsage,
            { providerCategory: isTimeout ? "timeout" : responseReceived ? "response" : "transport" },
          );
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }
      return fail("provider", requestMaxAttempts, undefined, { providerCategory: "transport" });
    },
  };
}
