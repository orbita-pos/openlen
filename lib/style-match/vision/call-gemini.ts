import type { ExtractedTokens } from "../extract/types";
import { buildUserMessage, SYSTEM_PROMPT } from "./prompt";
import { VisionAnalysisSchema, type VisionAnalysis } from "./schema";

// Google AI Studio endpoint. `gemini-2.5-flash` is the default because it has
// a real free tier (10 RPM / 1500 RPD); `gemini-2.5-pro` requires billing
// enabled. Flash is B+ design taste per research — enough for Phase 0; user
// can swap up to Pro by setting STYLE_MATCH_VISION_MODEL=gemini-2.5-pro after
// adding a billing account.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_ID =
  process.env.STYLE_MATCH_VISION_MODEL || "gemini-2.5-flash";
const MAX_TOKENS = 3_000;
const TEMPERATURE = 0.3;

export interface VisionCallResult {
  analysis?: VisionAnalysis;
  raw?: string;
  error?: {
    kind: "api" | "parse" | "schema" | "missing-key";
    message: string;
  };
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
}

export interface VisionCallInput {
  tokens: ExtractedTokens;
  screenshot: Buffer;
  screenshotMime?: "image/jpeg" | "image/png";
  modelId?: string;
}

function tryExtractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to fence-stripping.
  }
  const fenceStripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  try {
    return JSON.parse(fenceStripped);
  } catch {
    // Fall through to bracket scan.
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return null;
    }
  }
  return null;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
}

export async function callGeminiVision(
  input: VisionCallInput,
): Promise<VisionCallResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  const t0 = Date.now();
  if (!apiKey) {
    return {
      error: {
        kind: "missing-key",
        message:
          "GEMINI_API_KEY env var not set. Create one at https://aistudio.google.com/ then add it to .env.local.",
      },
      durationMs: Date.now() - t0,
    };
  }

  const mime = input.screenshotMime ?? "image/jpeg";
  const parts = buildUserMessage(input.tokens, input.screenshot, mime);

  const url = `${GEMINI_BASE}/${input.modelId ?? MODEL_ID}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          { inline_data: { mime_type: parts.imageMime, data: parts.imageBase64 } },
          { text: parts.text },
        ],
      },
    ],
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_TOKENS,
      responseMimeType: "application/json",
      // Disable Gemini 2.5's "thinking" tokens. They count against
      // maxOutputTokens and silently truncate the visible response. For
      // a strict JSON-schema task with two-shot examples we don't need
      // reasoning — just emit the answer.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      error: {
        kind: "api",
        message: err instanceof Error ? err.message : String(err),
      },
      durationMs: Date.now() - t0,
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      error: {
        kind: "api",
        message: `Gemini API ${response.status}: ${text.slice(0, 600)}`,
      },
      durationMs: Date.now() - t0,
    };
  }

  let payload: GeminiResponse;
  try {
    payload = (await response.json()) as GeminiResponse;
  } catch (err) {
    return {
      error: {
        kind: "parse",
        message: `Could not parse Gemini response: ${err instanceof Error ? err.message : String(err)}`,
      },
      durationMs: Date.now() - t0,
    };
  }

  if (payload.promptFeedback?.blockReason) {
    return {
      error: {
        kind: "api",
        message: `Gemini blocked prompt: ${payload.promptFeedback.blockReason}`,
      },
      durationMs: Date.now() - t0,
    };
  }

  const raw =
    payload.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("") ?? "";

  const usage = payload.usageMetadata
    ? {
        inputTokens: payload.usageMetadata.promptTokenCount ?? 0,
        outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0,
      }
    : undefined;

  if (!raw.trim()) {
    return {
      raw,
      usage,
      error: {
        kind: "parse",
        message: `Empty content. finishReason=${payload.candidates?.[0]?.finishReason ?? "unknown"}`,
      },
      durationMs: Date.now() - t0,
    };
  }

  const finishReason = payload.candidates?.[0]?.finishReason ?? "unknown";
  const parsed = tryExtractJson(raw);
  if (parsed === null) {
    return {
      raw,
      usage,
      error: {
        kind: "parse",
        message: `Could not extract JSON (finishReason=${finishReason})`,
      },
      durationMs: Date.now() - t0,
    };
  }

  const validated = VisionAnalysisSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      raw,
      usage,
      error: {
        kind: "schema",
        message: validated.error.issues
          .slice(0, 4)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(" | "),
      },
      durationMs: Date.now() - t0,
    };
  }

  return {
    analysis: validated.data,
    raw,
    usage,
    durationMs: Date.now() - t0,
  };
}
