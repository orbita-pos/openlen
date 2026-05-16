import type {
  ImageModelId,
  TextModelId,
} from "./models";
import {
  MODELS,
  priceImageCall,
  priceTextCall,
  toTogetherSlug,
} from "./models";
import { mockImage, mockText } from "./mock";

// ─────────────────────────────────────────────────────────────────────────────
// Together AI SDK wrapper.
//
// Two boundaries crossed here:
//   1. Real vs. mock. Default is REAL — opt into mock with `MOCK_MODE=1`.
//   2. Vendor SDK shape vs. our normalized {content, inputTokens, ...} shape.
//      Pipeline code never touches the raw SDK — all calls flow through
//      `completeText` / `generateImage`.
//
// Together caches identical prompt prefixes automatically; callers do not need
// to pass any cache directive. The SDK reports cache hits via
// `usage.prompt_tokens_details.cached_tokens` which we surface to the witness
// recorder and to the pricing math (Kimi/DeepSeek discount cached input ~6×).
// ─────────────────────────────────────────────────────────────────────────────

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /**
   * Hint that this message contains stable prefix content worth caching.
   * Together caches automatically; this flag is preserved for the mock layer
   * (which uses it to simulate cache hits) and as documentation for readers.
   */
  cache?: boolean;
}

export interface TextCallRequest {
  model: TextModelId;
  messages: ChatMessage[];
  /** When set, the model is steered to emit valid JSON. */
  responseFormat?: "text" | "json";
  temperature?: number;
  maxTokens?: number;
  /** Optional override that mock dispatch uses to select a canned response. */
  mockKey?: string;
}

export interface TextCallResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  latencyMs: number;
  costUsd: number;
  /** True when Together AI reported a prompt-cache hit on input tokens. */
  cached: boolean;
  /** True when the response came from the mock module. */
  mocked: boolean;
}

export interface ImageCallRequest {
  model: ImageModelId;
  prompt: string;
  aspectRatio?: "1:1" | "16:9" | "4:3" | "3:4" | "9:16";
  mockKey?: string;
}

export interface ImageCallResult {
  url: string;
  latencyMs: number;
  costUsd: number;
  mocked: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed errors. Pipeline code can match on these to decide whether a failure
// is recoverable (rate limit / transient) vs structural (auth, model gone).
// ─────────────────────────────────────────────────────────────────────────────

export class TogetherCallError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TogetherCallError";
  }
}

export class RateLimitError extends TogetherCallError {
  constructor(message: string, cause?: unknown) {
    super(message, 429, cause);
    this.name = "RateLimitError";
  }
}

export class ModelUnavailableError extends TogetherCallError {
  constructor(message: string, cause?: unknown) {
    super(message, 404, cause);
    this.name = "ModelUnavailableError";
  }
}

export class InvalidOutputError extends TogetherCallError {
  constructor(message: string, cause?: unknown) {
    super(message, 422, cause);
    this.name = "InvalidOutputError";
  }
}

export class TimeoutError extends TogetherCallError {
  constructor(message: string, cause?: unknown) {
    super(message, undefined, cause);
    this.name = "TimeoutError";
  }
}

export function isMockMode(): boolean {
  // Default OFF — real Together calls. Set MOCK_MODE=1 (or "true") for the
  // dev loop on UI work where you don't want to spend credits.
  const raw = process.env.MOCK_MODE;
  if (raw === undefined) return false;
  return raw === "1" || raw.toLowerCase() === "true";
}

// SDK is lazy-loaded so MOCK_MODE never pays for the import or the API key
// validation. Cached singleton — one client per process.
let cachedSdk: { client: TogetherClientShape } | null = null;

interface TogetherClientShape {
  chat: {
    completions: {
      create: (args: Record<string, unknown>) => Promise<unknown>;
    };
  };
  images: { create: (args: Record<string, unknown>) => Promise<unknown> };
}

async function getSdk(): Promise<{ client: TogetherClientShape }> {
  if (cachedSdk) return cachedSdk;
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "TOGETHER_API_KEY is not set. Either provide a key or run with MOCK_MODE=1.",
    );
  }
  const mod = (await import("together-ai")) as unknown as {
    default: new (options: { apiKey: string }) => TogetherClientShape;
  };
  const TogetherCtor = mod.default;
  const client = new TogetherCtor({ apiKey });
  cachedSdk = { client };
  return cachedSdk;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry policy: exponential backoff up to 3 attempts, capped at a 30s
// wall-clock total per call. Only retry on transient errors — rate limits,
// 5xx, network/timeouts. Auth and "model not found" fail fast.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const TOTAL_TIMEOUT_MS = 30_000;

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  const startedAt = Date.now();
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= TOTAL_TIMEOUT_MS) {
      throw new TimeoutError(`${label}: total retry budget exhausted (${elapsed}ms)`, lastErr);
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const normalized = normalizeError(err);
      // Fail fast on non-transient errors.
      if (
        normalized instanceof ModelUnavailableError ||
        (normalized instanceof TogetherCallError &&
          normalized.status !== undefined &&
          normalized.status >= 400 &&
          normalized.status < 500 &&
          normalized.status !== 429)
      ) {
        throw normalized;
      }
      if (attempt === MAX_RETRIES) throw normalized;
      // Backoff: 500ms, 1500ms, 4500ms — but never sleep past the budget.
      const backoff = Math.min(500 * 3 ** (attempt - 1), TOTAL_TIMEOUT_MS - elapsed - 100);
      if (backoff <= 0) throw normalized;
      await sleep(backoff);
    }
  }
  // Unreachable — the loop either returns or throws.
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function normalizeError(err: unknown): TogetherCallError {
  if (err instanceof TogetherCallError) return err;
  // The Together SDK throws subclasses of APIError with `status` and `message`.
  // We don't `instanceof` against the SDK classes (would force eager import);
  // duck-type on the shape instead.
  const e = err as { status?: number; message?: string; name?: string };
  const status = typeof e.status === "number" ? e.status : undefined;
  const message = e.message ?? String(err);

  if (status === 429) return new RateLimitError(message, err);
  if (status === 404 || /model.*not.*found|unknown model/i.test(message)) {
    return new ModelUnavailableError(message, err);
  }
  if (status === 422 || /invalid.*response|malformed/i.test(message)) {
    return new InvalidOutputError(message, err);
  }
  if (e.name === "APIConnectionTimeoutError" || /timeout/i.test(message)) {
    return new TimeoutError(message, err);
  }
  return new TogetherCallError(message, status, err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function completeText(req: TextCallRequest): Promise<TextCallResult> {
  const started = Date.now();
  if (isMockMode()) {
    const mock = await mockText(req);
    return {
      ...mock,
      cachedInputTokens: mock.cached ? mock.inputTokens : 0,
      latencyMs: Date.now() - started,
      mocked: true,
    };
  }

  const sdk = await getSdk();
  const togetherMessages = req.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const raw = await withRetry(
    () =>
      sdk.client.chat.completions.create({
        model: toTogetherSlug(req.model),
        messages: togetherMessages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 2048,
        ...(req.responseFormat === "json"
          ? { response_format: { type: "json_object" } }
          : {}),
      }),
    `completeText(${req.model})`,
  );

  const parsed = raw as {
    choices: { message: { content: string } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };

  const inputTokens = parsed.usage?.prompt_tokens ?? 0;
  const outputTokens = parsed.usage?.completion_tokens ?? 0;
  const cachedInputTokens = parsed.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const costUsd = priceTextCall(req.model, inputTokens, outputTokens, cachedInputTokens);

  return {
    content: parsed.choices[0]?.message?.content ?? "",
    inputTokens,
    outputTokens,
    cachedInputTokens,
    latencyMs: Date.now() - started,
    costUsd,
    cached: cachedInputTokens > 0,
    mocked: false,
  };
}

export async function generateImage(
  req: ImageCallRequest,
): Promise<ImageCallResult> {
  const started = Date.now();
  if (isMockMode()) {
    const mock = await mockImage(req);
    return {
      ...mock,
      latencyMs: Date.now() - started,
      mocked: true,
    };
  }

  const sdk = await getSdk();
  const raw = await withRetry(
    () =>
      sdk.client.images.create({
        model: toTogetherSlug(req.model),
        prompt: req.prompt,
        ...aspectRatioToSize(req.aspectRatio ?? "16:9"),
        n: 1,
        response_format: "url",
      }),
    `generateImage(${req.model})`,
  );

  const parsed = raw as { data: { url?: string; b64_json?: string }[] };
  const first = parsed.data[0];
  const url = first?.url ?? (first?.b64_json ? `data:image/jpeg;base64,${first.b64_json}` : "");
  if (!url) {
    throw new InvalidOutputError(
      `generateImage(${req.model}): empty image data returned`,
    );
  }

  return {
    url,
    latencyMs: Date.now() - started,
    costUsd: priceImageCall(req.model),
    mocked: false,
  };
}

function aspectRatioToSize(ar: string): { width: number; height: number } {
  switch (ar) {
    case "1:1":
      return { width: 1024, height: 1024 };
    case "4:3":
      return { width: 1024, height: 768 };
    case "3:4":
      return { width: 768, height: 1024 };
    case "9:16":
      return { width: 720, height: 1280 };
    case "16:9":
    default:
      return { width: 1280, height: 720 };
  }
}

export { MODELS };
