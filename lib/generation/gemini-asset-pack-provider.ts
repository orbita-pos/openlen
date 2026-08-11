import { createHash } from "node:crypto";

import {
  AssetIntentSchema,
  type AssetIntent,
  type AssetManifest,
} from "@/lib/generation/asset-contracts";
import { validateGeneratedImage } from "@/lib/generation/asset-image-validation";
import {
  parseAssetGenerationBudget,
  type AssetGenerationBudget,
  type AssetPackProvider,
  type AssetPackRequest,
  type AssetPackResult,
  type AssetPackUsage,
} from "@/lib/generation/asset-pack-provider";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";
const PROVIDER = "google_gemini";
const MAX_ASSETS = 3;
const MAX_PROMPT_LENGTH = 1_200;
const DEFAULT_TIMEOUT_MS = 60_000;
const TAXONOMY_SLUG = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const MODEL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

type SupportedImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface GeminiAssetPackProviderOptions {
  apiKey?: string;
  modelId?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

interface ParsedGeminiImage {
  bytes: Buffer;
  mimeType: SupportedImageMimeType;
  usage?: AssetPackUsage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function validPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function optionalTokenCount(value: unknown): number | null {
  return value === undefined ? 0 : validTokenCount(value) ? value : null;
}

function readUsage(payload: unknown): AssetPackUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usageMetadata)) return undefined;
  const metadata = payload.usageMetadata;
  const cachedTokens = optionalTokenCount(metadata.cachedContentTokenCount);
  const thinkingTokens = optionalTokenCount(metadata.thoughtsTokenCount);
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

function addUsage(total: AssetPackUsage | undefined, next: AssetPackUsage | undefined): AssetPackUsage | undefined {
  if (!next) return total;
  const base = total ?? { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thinkingTokens: 0 };
  return {
    inputTokens: base.inputTokens + next.inputTokens,
    outputTokens: base.outputTokens + next.outputTokens,
    cachedTokens: base.cachedTokens + next.cachedTokens,
    thinkingTokens: base.thinkingTokens + next.thinkingTokens,
  };
}

function elapsed(started: number, now: () => number): number {
  return Math.max(0, Math.floor(now() - started));
}

function validBudget(value: unknown): value is AssetGenerationBudget {
  return exactKeys(value, ["estimatedImageCostMicromxn", "maxCostMicromxn", "version"])
    && typeof value.version === "string"
    && /^[1-9][0-9]*$/.test(value.version)
    && validPositiveInteger(value.maxCostMicromxn)
    && validPositiveInteger(value.estimatedImageCostMicromxn);
}

function sameBudget(left: AssetGenerationBudget, right: AssetGenerationBudget): boolean {
  return left.version === right.version
    && left.maxCostMicromxn === right.maxCostMicromxn
    && left.estimatedImageCostMicromxn === right.estimatedImageCostMicromxn;
}

function validTaxonomyList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 12
    && value.every((item) => typeof item === "string" && TAXONOMY_SLUG.test(item));
}

function validConsistencyGroup(value: unknown): value is AssetManifest["consistencyGroup"] {
  if (!exactKeys(value, ["artDirection", "id", "mediaType", "paletteHints", "styleLock"])) return false;
  return typeof value.id === "string"
    && /^[a-z0-9][a-z0-9-]{0,95}$/.test(value.id)
    && (value.mediaType === "photo" || value.mediaType === "illustration" || value.mediaType === "texture")
    && typeof value.artDirection === "string"
    && TAXONOMY_SLUG.test(value.artDirection)
    && validTaxonomyList(value.paletteHints)
    && typeof value.styleLock === "string"
    && TAXONOMY_SLUG.test(value.styleLock);
}

function validRequest(request: AssetPackRequest): boolean {
  if (!exactKeys(request, ["assets", "budget", "consistencyGroup", "schemaVersion"])) return false;
  if (request.schemaVersion !== "asset-pack-request/1.0"
    || !validBudget(request.budget)
    || !validConsistencyGroup(request.consistencyGroup)
    || !Array.isArray(request.assets)
    || request.assets.length < 1
    || request.assets.length > MAX_ASSETS) return false;
  const slotIndexes = new Set<number>();
  for (const asset of request.assets) {
    const parsed = AssetIntentSchema.safeParse(asset);
    if (!parsed.success
      || parsed.data.mediaType !== request.consistencyGroup.mediaType
      || slotIndexes.has(parsed.data.slotIndex)) return false;
    slotIndexes.add(parsed.data.slotIndex);
  }
  return true;
}

function line(label: string, values: readonly string[]): string {
  return `${label}: ${values.length > 0 ? values.join(", ") : "none"}.`;
}

function buildPrompt(asset: AssetIntent, group: AssetManifest["consistencyGroup"]): string | null {
  const prompt = [
    "Generate exactly one website image. Return image bytes only; no text, logos, marks, borders, or mock interface.",
    `Media type: ${group.mediaType}.`,
    `Art direction: ${group.artDirection}.`,
    line("Palette hints", group.paletteHints),
    `Style lock: ${group.styleLock}.`,
    `Slot role: ${asset.role}.`,
    line("Subjects", asset.subjects),
    line("Domains", asset.domains),
    line("Audiences", asset.audiences),
    `Visual archetype: ${asset.visualArchetype}.`,
    line("Emotional tone", asset.emotionalTone),
    `Aspect ratio: ${asset.aspectRatio}.`,
    `Focal point: ${asset.focalPoint}.`,
    line("Required visual signals", asset.requiredSignals),
    line("Forbidden visual signals", asset.forbiddenSignals),
  ].join("\n");
  return prompt.length <= MAX_PROMPT_LENGTH ? prompt : null;
}

function isBlocked(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (isRecord(payload.promptFeedback) && typeof payload.promptFeedback.blockReason === "string") return true;
  const first = Array.isArray(payload.candidates) ? payload.candidates[0] : null;
  if (!isRecord(first) || typeof first.finishReason !== "string") return false;
  return ["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "IMAGE_SAFETY"].includes(first.finishReason);
}

function strictBase64(value: string): Buffer | null {
  if (value.length === 0 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : null;
}

async function parseInlineImage(payload: unknown): Promise<ParsedGeminiImage | "blocked" | "invalid_response" | "invalid_image"> {
  const usage = readUsage(payload);
  if (isBlocked(payload)) return "blocked";
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) return "invalid_response";
  const first = payload.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) return "invalid_response";
  const parts = first.content.parts;
  if (parts.some((part) => isRecord(part) && ("fileData" in part || (isRecord(part.inlineData) && "uri" in part.inlineData)))) {
    return "invalid_response";
  }
  const images = parts.filter((part) => isRecord(part) && isRecord(part.inlineData) && typeof part.inlineData.data === "string");
  if (images.length !== 1) return "invalid_response";
  const inlineData = (images[0] as { inlineData: Record<string, unknown> }).inlineData;
  if (inlineData.mimeType !== "image/png" && inlineData.mimeType !== "image/jpeg" && inlineData.mimeType !== "image/webp") return "invalid_image";
  const bytes = strictBase64(inlineData.data as string);
  if (!bytes) return "invalid_image";
  try {
    await validateGeneratedImage(bytes, inlineData.mimeType);
  } catch {
    return "invalid_image";
  }
  return { bytes, mimeType: inlineData.mimeType, ...(usage ? { usage } : {}) };
}

function failure(
  code: Extract<AssetPackResult, { ok: false }>["code"],
  modelId: string,
  started: number,
  now: () => number,
  usage?: AssetPackUsage,
): AssetPackResult {
  return {
    ok: false,
    code,
    provider: PROVIDER,
    modelId,
    ...(usage ? { usage } : {}),
    durationMs: elapsed(started, now),
  };
}

function configuredBudget(env: NodeJS.ProcessEnv): AssetGenerationBudget | null {
  try {
    return parseAssetGenerationBudget(env);
  } catch {
    return null;
  }
}

function selectModelId(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && MODEL_IDENTIFIER.test(trimmed)) return trimmed;
  }
  return DEFAULT_IMAGE_MODEL;
}

export function createGeminiAssetPackProvider(options: GeminiAssetPackProviderOptions = {}): AssetPackProvider {
  const env = options.env ?? process.env;
  const apiKey = options.apiKey ?? env.GEMINI_API_KEY;
  const modelId = selectModelId(
    options.modelId,
    env.OPENLEN_ASSET_IMAGE_MODEL,
    env.OPENLEN_IMAGE_EDIT_MODEL,
    DEFAULT_IMAGE_MODEL,
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
    ? Math.max(1, Math.floor(options.timeoutMs as number))
    : DEFAULT_TIMEOUT_MS;

  return {
    capabilities() {
      return {
        generate: Boolean(apiKey && configuredBudget(env)),
        editFromReference: true,
        maxAssets: MAX_ASSETS,
      };
    },

    async createPack(request: AssetPackRequest): Promise<AssetPackResult> {
      const started = now();
      const operationalBudget = configuredBudget(env);
      if (!apiKey || !operationalBudget) return failure("provider_unavailable", modelId, started, now);
      if (!validRequest(request)) return failure("invalid_provider_response", modelId, started, now);
      if (!sameBudget(request.budget, operationalBudget)) {
        return failure("budget_exhausted", modelId, started, now);
      }
      const estimatedCostMicromxn = request.assets.length * request.budget.estimatedImageCostMicromxn;
      if (!Number.isSafeInteger(estimatedCostMicromxn) || estimatedCostMicromxn > request.budget.maxCostMicromxn) {
        return failure("budget_exhausted", modelId, started, now);
      }

      const prompts = request.assets.map((asset) => buildPrompt(asset, request.consistencyGroup));
      if (prompts.some((prompt) => prompt === null)) {
        return failure("invalid_provider_response", modelId, started, now);
      }

      const images: Extract<AssetPackResult, { ok: true }>["images"] = [];
      let firstImage: { bytes: Buffer; mimeType: SupportedImageMimeType } | null = null;
      let usage: AssetPackUsage | undefined;

      for (let index = 0; index < request.assets.length; index += 1) {
        const asset = request.assets[index];
        const prompt = prompts[index] as string;
        const parts: Array<Record<string, unknown>> = firstImage
          ? [
              { inlineData: { mimeType: firstImage.mimeType, data: firstImage.bytes.toString("base64") } },
              { text: prompt },
            ]
          : [{ text: prompt }];
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let didTimeout = false;
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            didTimeout = true;
            controller.abort();
            reject(new Error("asset_provider_timeout"));
          }, timeoutMs);
        });

        let response: Response;
        try {
          response = await Promise.race([
            fetchImpl(`${GEMINI_BASE}/${encodeURIComponent(modelId)}:generateContent`, {
              method: "POST",
              headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
              signal: controller.signal,
              body: JSON.stringify({
                contents: [{ role: "user", parts }],
                generationConfig: { responseModalities: ["IMAGE"] },
              }),
            }),
            timeout,
          ]);
        } catch {
          if (timer) clearTimeout(timer);
          return failure(didTimeout ? "provider_timeout" : "provider_error", modelId, started, now, usage);
        }

        let payload: unknown;
        try {
          payload = await Promise.race([response.json(), timeout]);
        } catch {
          if (timer) clearTimeout(timer);
          if (didTimeout) return failure("provider_timeout", modelId, started, now, usage);
          return failure(response.ok ? "invalid_provider_response" : "provider_error", modelId, started, now, usage);
        }
        if (timer) clearTimeout(timer);
        const responseUsage = readUsage(payload);
        usage = addUsage(usage, responseUsage);
        if (!response.ok) return failure("provider_error", modelId, started, now, usage);

        const parsed = await parseInlineImage(payload);
        if (parsed === "blocked") return failure("provider_blocked", modelId, started, now, usage);
        if (parsed === "invalid_response") return failure("invalid_provider_response", modelId, started, now, usage);
        if (parsed === "invalid_image") return failure("invalid_image", modelId, started, now, usage);
        if (!firstImage) firstImage = { bytes: parsed.bytes, mimeType: parsed.mimeType };
        images.push({
          slotIndex: asset.slotIndex,
          bytes: parsed.bytes,
          mimeType: parsed.mimeType,
          prompt,
          promptSha256: `sha256:${createHash("sha256").update(prompt).digest("hex")}`,
        });
      }

      return {
        ok: true,
        provider: PROVIDER,
        modelId,
        images,
        ...(usage ? { usage } : {}),
        estimatedCostMicromxn,
        durationMs: elapsed(started, now),
      };
    },
  };
}
