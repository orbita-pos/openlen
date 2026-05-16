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
//   1. Real vs. mock. Switched on `MOCK_MODE=1` env. In mock mode we never
//      import the SDK at runtime, so credits stay at zero even if the package
//      is installed.
//   2. Vendor SDK shape vs. our normalized {content, inputTokens, ...} shape.
//      Pipeline code never touches the raw SDK — all calls flow through
//      `completeText` / `generateImage`.
// ─────────────────────────────────────────────────────────────────────────────

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** When true, Together AI is asked to cache this message (ephemeral cache). */
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

export function isMockMode(): boolean {
  // Default to mock mode when the env is unset to protect against accidental
  // real spend during local dev. Only an explicit "0"/"false" disables it.
  const raw = process.env.MOCK_MODE;
  if (raw === undefined) return true;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

let cachedSdk: unknown | null = null;
async function getSdk(): Promise<{
  client: {
    chat: {
      completions: {
        create: (args: Record<string, unknown>) => Promise<unknown>;
      };
    };
    images: { create: (args: Record<string, unknown>) => Promise<unknown> };
  };
}> {
  if (cachedSdk) return cachedSdk as { client: never };
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "TOGETHER_API_KEY is not set. Either provide a key or run with MOCK_MODE=1.",
    );
  }
  // Lazy import so that mock-mode dev never pays the SDK initialization cost.
  const mod = (await import("together-ai")) as unknown as {
    default: new (options: { apiKey: string }) => unknown;
  };
  const TogetherCtor = mod.default;
  const client = new TogetherCtor({ apiKey }) as never;
  cachedSdk = { client };
  return cachedSdk as { client: never };
}

export async function completeText(req: TextCallRequest): Promise<TextCallResult> {
  const started = Date.now();
  if (isMockMode()) {
    const mock = await mockText(req);
    return {
      ...mock,
      latencyMs: Date.now() - started,
      mocked: true,
    };
  }

  const sdk = await getSdk();
  const togetherMessages = req.messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.cache ? { cache_control: { type: "ephemeral" } } : {}),
  }));
  const raw = (await sdk.client.chat.completions.create({
    model: toTogetherSlug(req.model),
    messages: togetherMessages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? 2048,
    ...(req.responseFormat === "json"
      ? { response_format: { type: "json_object" } }
      : {}),
  })) as {
    choices: { message: { content: string } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cached_tokens?: number;
    };
  };

  const inputTokens = raw.usage?.prompt_tokens ?? 0;
  const outputTokens = raw.usage?.completion_tokens ?? 0;
  const cached = (raw.usage?.cached_tokens ?? 0) > 0;
  const costUsd = priceTextCall(req.model, inputTokens, outputTokens);

  return {
    content: raw.choices[0]?.message?.content ?? "",
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - started,
    costUsd,
    cached,
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
  const raw = (await sdk.client.images.create({
    model: toTogetherSlug(req.model),
    prompt: req.prompt,
    // Map our friendly aspect ratio to a width/height pair. These are coarse;
    // real-mode prompt tuning happens in Phase 2.
    ...aspectRatioToSize(req.aspectRatio ?? "16:9"),
    n: 1,
  })) as { data: { url: string }[] };

  return {
    url: raw.data[0]?.url ?? "",
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
