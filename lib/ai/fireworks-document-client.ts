import { modelIdForRole } from "../generation/fable-model-policy";
import type { ModelTokenUsage } from "../generation/model-cost";
import type { PageBudget } from "../generation/page-generation-budget";
import type {
  FireworksDocumentRequest,
  FireworksDocumentResult,
  FireworksProviderCategory,
} from "./fireworks-contracts";
import { decodeFireworksUsage, DEFAULT_FIREWORKS_TIMEOUT_MS } from "./fireworks-client";

const FIREWORKS_ENDPOINT = "https://api.fireworks.ai/inference/v1/chat/completions";
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ZERO_USAGE: ModelTokenUsage = Object.freeze({ inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 });
/** Deliberately above any real tokenizer ratio so a reservation is never short. */
const BYTES_PER_RESERVED_TOKEN = 3;

type Environment = Readonly<Record<string, string | undefined>>;
type FailureCode = Extract<FireworksDocumentResult, { ok: false }>["code"];

export interface FireworksDocumentClient {
  write(request: FireworksDocumentRequest): Promise<FireworksDocumentResult>;
}

export interface FireworksDocumentClientOptions {
  readonly apiKey?: string;
  readonly env?: Environment;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly budget: PageBudget;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Reads the assistant text out of whatever OpenAI-compatible shape the provider
 * chose. This boundary is deliberately permissive: unknown sibling keys, extra
 * choices, part arrays, and the legacy completions `text` field are all normal
 * provider variation, and none of them are a reason to throw away a page.
 */
function messageText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((part) => {
        const entry = record(part);
        if (!entry) return null;
        return typeof entry.text === "string" ? entry.text : null;
      })
      .filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join("") : null;
  }
  return null;
}

interface DecodedChoice {
  readonly text: string;
  readonly truncated: boolean;
}

export function decodeDocumentChoice(value: unknown): DecodedChoice | null {
  const root = record(value);
  if (!root || !Array.isArray(root.choices) || root.choices.length === 0) return null;
  for (const rawChoice of root.choices) {
    const choice = record(rawChoice);
    if (!choice) continue;
    const message = record(choice.message);
    const text = messageText(message?.content) ?? messageText(choice.text);
    if (text === null || text.trim().length === 0) continue;
    return { text, truncated: choice.finish_reason === "length" };
  }
  return null;
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

function validRequest(request: FireworksDocumentRequest): boolean {
  return Array.isArray(request.messages)
    && request.messages.length > 0
    && request.messages.every((message) => (
      (message.role === "system" || message.role === "user" || message.role === "assistant")
      && typeof message.content === "string"
      && message.content.length > 0
    ))
    && Number.isSafeInteger(request.maxOutputTokens)
    && request.maxOutputTokens > 0
    && REQUEST_ID.test(request.requestId);
}

export function createFireworksDocumentClient(options: FireworksDocumentClientOptions): FireworksDocumentClient {
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
    async write(request): Promise<FireworksDocumentResult> {
      const started = now();
      const fail = (
        code: FailureCode,
        usage?: ModelTokenUsage,
        diagnostics?: { providerCategory?: FireworksProviderCategory; httpStatus?: number },
      ): FireworksDocumentResult => ({
        ok: false,
        code,
        ...(usage ? { usage } : {}),
        ...(diagnostics?.providerCategory ? { providerCategory: diagnostics.providerCategory } : {}),
        ...(diagnostics?.httpStatus !== undefined ? { httpStatus: diagnostics.httpStatus } : {}),
        durationMs: elapsed(started, now),
        modelId,
      });

      if (!apiKey) return fail("missing_key");
      if (!validRequest(request)) return fail("provider", undefined, { providerCategory: "request" });

      const payload = JSON.stringify({
        model: modelId,
        messages: request.messages,
        max_tokens: request.maxOutputTokens,
        reasoning_effort: request.reasoningEffort ?? "high",
        temperature: request.temperature ?? 0.7,
        user: request.requestId,
      });
      const lease = options.budget.reserve({
        kind: "model",
        modelId,
        maxInputTokens: Math.max(1, Math.ceil(new TextEncoder().encode(payload).length / BYTES_PER_RESERVED_TOKEN)),
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
      /**
       * Releases the lease exactly once. A call that reported no usage books
       * zero rather than the worst-case reservation: charging a reservation the
       * provider never billed puts money that was never spent into the page
       * cost report, which is the number release decisions are read from.
       */
      const settle = (): boolean => {
        if (settled) return true;
        settled = true;
        try {
          options.budget.complete(lease.leaseId, usage ?? ZERO_USAGE);
          return true;
        } catch {
          return false;
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
        const body = await Promise.race([response.text(), deadline]);
        let decoded: unknown;
        if (body.length > 0) {
          try { decoded = JSON.parse(body); } catch { decoded = undefined; }
        }
        usage = decodeFireworksUsage(decoded);
        const usageKnown = usage !== undefined;
        if (!settle()) return fail("budget_exceeded", usage);
        if (!response.ok) return fail("http", usage, { providerCategory: "http", httpStatus: response.status });
        if (decoded === undefined) return fail("provider", usage, { providerCategory: "response_envelope" });
        const choice = decodeDocumentChoice(decoded);
        if (!choice) return fail("empty", usage, { providerCategory: "response_content" });
        return {
          ok: true,
          text: choice.text,
          truncated: choice.truncated,
          usage: usage ?? ZERO_USAGE,
          usageKnown,
          durationMs: elapsed(started, now),
          modelId,
        };
      } catch (error) {
        settle();
        return fail(timedOut || connectionTimeout(error) ? "timeout" : "provider", usage, { providerCategory: "transport" });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
