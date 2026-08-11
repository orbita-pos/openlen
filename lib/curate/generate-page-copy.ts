import { z } from "zod";
import {
  LenientBusinessDataSchema,
  type ExtractedBusinessData,
} from "../style-match/autofill/types";
import type { ModelTokenUsage } from "../generation/model-cost";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_OUTPUT_TOKENS = 6_000;

export const PAGE_COPY_PROMPT_VERSION = "page-copy-prompt/1.0" as const;
export const PAGE_COPY_TIMEOUT_MS = 12_000;

export type GeneratePageCopyFailureKind =
  | "invalid_input"
  | "missing_key"
  | "timeout"
  | "aborted"
  | "http"
  | "provider"
  | "parse"
  | "schema";

export type GeneratePageCopyResult =
  | {
      ok: true;
      copy: ExtractedBusinessData;
      modelId: string;
      promptVersion: typeof PAGE_COPY_PROMPT_VERSION;
      usage?: ModelTokenUsage;
      durationMs: number;
    }
  | {
      ok: false;
      error: { kind: GeneratePageCopyFailureKind; message: string };
      modelId: string;
      promptVersion: typeof PAGE_COPY_PROMPT_VERSION;
      usage?: ModelTokenUsage;
      durationMs: number;
    };

export interface GeneratePageCopyOptions {
  apiKey?: string;
  modelId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const PageCopyEnvelopeSchema = z.object({
  schemaVersion: z.literal("page-copy/1.0"),
  copy: LenientBusinessDataSchema,
}).strict();

const PAGE_COPY_SYSTEM_PROMPT = `You create believable, specific, on-brand demo page copy for OpenLen.
Given a business brief, invent a confident customer-facing demo: a product or company name, a punchy tagline, a one-to-two sentence overview, a hero keyword, three-to-six concrete features, realistic pricing tiers when the brief implies a paid product, two-to-three fictional testimonials with plausible names, three-to-five FAQ answers, and natural calls to action.
Avoid generic filler such as "Lorem ipsum" or "Your tagline here". Write in the brief's language and identify that language.
Output strict JSON only, with no markdown or prose, in this shape: {"schemaVersion":"page-copy/1.0","copy":{...}}.`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function optionalZeroTokenCount(value: unknown): number | null {
  if (value === undefined) return 0;
  return validTokenCount(value) ? value : null;
}

function readUsageMetadata(payload: unknown): ModelTokenUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usageMetadata)) return undefined;
  const metadata = payload.usageMetadata;
  const cachedTokens = optionalZeroTokenCount(metadata.cachedContentTokenCount);
  const thinkingTokens = optionalZeroTokenCount(metadata.thoughtsTokenCount);
  if (!validTokenCount(metadata.promptTokenCount)
    || !validTokenCount(metadata.candidatesTokenCount)
    || cachedTokens === null
    || thinkingTokens === null) return undefined;
  return {
    inputTokens: metadata.promptTokenCount,
    outputTokens: metadata.candidatesTokenCount,
    cachedTokens,
    thinkingTokens,
  };
}

function duration(started: number, now: () => number): number {
  return Math.max(0, now() - started);
}

function timeoutMilliseconds(value: number | undefined): number {
  if (value === undefined) return PAGE_COPY_TIMEOUT_MS;
  return Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : PAGE_COPY_TIMEOUT_MS;
}

function stripFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function responseParts(payload: unknown): Array<unknown> | null {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) return null;
  const first = payload.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) return null;
  return first.content.parts;
}

async function requestPageCopy(
  brief: string,
  apiKey: string,
  modelId: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  cancellation: { kind: "aborted" | "timeout" | null },
  base: { modelId: string; promptVersion: typeof PAGE_COPY_PROMPT_VERSION },
  elapsed: () => number,
): Promise<GeneratePageCopyResult> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${GEMINI_BASE}/${encodeURIComponent(modelId)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: PAGE_COPY_SYSTEM_PROMPT }] },
          contents: [{
            role: "user",
            parts: [{ text: `Brief:\n\n${brief.trim()}\n\nReturn page copy JSON only.` }],
          }],
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );
  } catch {
    const kind = cancellation.kind ?? "provider";
    return {
      ok: false,
      ...base,
      error: {
        kind,
        message: kind === "timeout"
          ? "page copy generation timed out"
          : kind === "aborted"
            ? "page copy generation aborted"
            : "Gemini request failed",
      },
      durationMs: elapsed(),
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      ...base,
      error: {
        kind: response.ok ? "provider" : "http",
        message: response.ok ? "invalid Gemini response envelope" : `Gemini ${response.status}`,
      },
      durationMs: elapsed(),
    };
  }

  const usage = readUsageMetadata(payload);
  if (!response.ok) {
    return {
      ok: false,
      ...base,
      error: { kind: "http", message: `Gemini ${response.status}` },
      ...(usage ? { usage } : {}),
      durationMs: elapsed(),
    };
  }

  const parts = responseParts(payload);
  if (!parts) {
    return {
      ok: false,
      ...base,
      error: { kind: "provider", message: "invalid Gemini response envelope" },
      durationMs: elapsed(),
    };
  }
  const raw = parts
    .map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "")
    .join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return {
      ok: false,
      ...base,
      error: { kind: "parse", message: "malformed page copy JSON" },
      ...(usage ? { usage } : {}),
      durationMs: elapsed(),
    };
  }

  const validated = PageCopyEnvelopeSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      ...base,
      error: { kind: "schema", message: "page copy schema validation failed" },
      ...(usage ? { usage } : {}),
      durationMs: elapsed(),
    };
  }

  return {
    ok: true,
    ...base,
    copy: validated.data.copy,
    ...(usage ? { usage } : {}),
    durationMs: elapsed(),
  };
}

export async function generatePageCopy(
  brief: string,
  options: GeneratePageCopyOptions = {},
): Promise<GeneratePageCopyResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const elapsed = () => duration(started, now);
  const modelId = options.modelId
    ?? process.env.OPENLEN_PAGE_COPY_MODEL
    ?? process.env.CURATE_PICK_MODEL
    ?? process.env.STYLE_MATCH_TEXT_MODEL
    ?? "gemini-2.5-flash";
  const base = { modelId, promptVersion: PAGE_COPY_PROMPT_VERSION };
  if (!brief.trim()) {
    return {
      ok: false,
      ...base,
      error: { kind: "invalid_input", message: "brief is required" },
      durationMs: elapsed(),
    };
  }

  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      ...base,
      error: { kind: "missing_key", message: "GEMINI_API_KEY not set" },
      durationMs: elapsed(),
    };
  }
  if (options.signal?.aborted) {
    return {
      ok: false,
      ...base,
      error: { kind: "aborted", message: "page copy generation aborted" },
      durationMs: elapsed(),
    };
  }

  const controller = new AbortController();
  const cancellation: { kind: "aborted" | "timeout" | null } = { kind: null };
  let resolveCancellation!: (value: GeneratePageCopyResult) => void;
  const cancelled = new Promise<GeneratePageCopyResult>((resolve) => {
    resolveCancellation = resolve;
  });
  const cancel = (kind: "aborted" | "timeout"): void => {
    if (cancellation.kind) return;
    cancellation.kind = kind;
    controller.abort();
    resolveCancellation({
      ok: false,
      ...base,
      error: {
        kind,
        message: kind === "timeout" ? "page copy generation timed out" : "page copy generation aborted",
      },
      durationMs: elapsed(),
    });
  };
  const timer = setTimeout(() => cancel("timeout"), timeoutMilliseconds(options.timeoutMs));
  const onAbort = () => cancel("aborted");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([
      requestPageCopy(
        brief,
        apiKey,
        modelId,
        options.fetchImpl ?? fetch,
        controller.signal,
        cancellation,
        base,
        elapsed,
      ),
      cancelled,
    ]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
