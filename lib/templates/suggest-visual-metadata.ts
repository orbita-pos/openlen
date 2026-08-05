import {
  TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION,
  TemplateVisualMetadataSchema,
  type TemplateVisualMetadata,
} from "./visual-metadata";
import type { TemplateRecord } from "./store";
import {
  VISUAL_METADATA_FAILURE_POLICY_VERSION,
  VISUAL_METADATA_GENERATION_CONFIG_VERSION,
  VISUAL_METADATA_MAXIMUM_FAILURE_RATE,
  VISUAL_METADATA_MODEL_CHOICE_VERSION,
  VISUAL_METADATA_PER_TEMPLATE_TIMEOUT_MS,
  VISUAL_METADATA_PROMPT_VERSION,
  VISUAL_METADATA_TIMEOUT_POLICY_VERSION,
  VISUAL_METADATA_WORKFLOW_VERSION,
} from "./visual-metadata-suggestion-contract";

export {
  VISUAL_METADATA_FAILURE_POLICY_VERSION,
  VISUAL_METADATA_GENERATION_CONFIG_VERSION,
  VISUAL_METADATA_MAXIMUM_FAILURE_RATE,
  VISUAL_METADATA_MODEL_CHOICE_VERSION,
  VISUAL_METADATA_PER_TEMPLATE_TIMEOUT_MS,
  VISUAL_METADATA_PROMPT_VERSION,
  VISUAL_METADATA_TIMEOUT_POLICY_VERSION,
  VISUAL_METADATA_WORKFLOW_VERSION,
};

const TAXONOMY_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "string" },
} as const;

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  description: "Taxonomy array items use lowercase snake_case.",
  additionalProperties: false,
  properties: {
    schemaVersion: {
      type: "string",
      enum: [TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION],
    },
    domains: TAXONOMY_ARRAY_SCHEMA,
    audiences: TAXONOMY_ARRAY_SCHEMA,
    ageRanges: {
      ...TAXONOMY_ARRAY_SCHEMA,
      description: "Use ranges such as 5_10, 18_24, or 65_plus; never hyphens.",
    },
    emotionalRegisters: TAXONOMY_ARRAY_SCHEMA,
    visualArchetypes: TAXONOMY_ARRAY_SCHEMA,
    visualSignals: TAXONOMY_ARRAY_SCHEMA,
    layoutTraits: TAXONOMY_ARRAY_SCHEMA,
    requiredAssetTypes: TAXONOMY_ARRAY_SCHEMA,
    negativeTags: TAXONOMY_ARRAY_SCHEMA,
    supportedSiteTypes: TAXONOMY_ARRAY_SCHEMA,
    supportedSectionRoles: TAXONOMY_ARRAY_SCHEMA,
    themeability: { type: "string", enum: ["low", "medium", "high"] },
    identityStrength: { type: "string", enum: ["low", "medium", "high"] },
    reviewStatus: {
      type: "string",
      enum: ["unreviewed"],
    },
  },
  required: [
    "schemaVersion",
    "domains",
    "audiences",
    "ageRanges",
    "emotionalRegisters",
    "visualArchetypes",
    "visualSignals",
    "layoutTraits",
    "requiredAssetTypes",
    "negativeTags",
    "supportedSiteTypes",
    "supportedSectionRoles",
    "themeability",
    "identityStrength",
    "reviewStatus",
  ],
} as const;

const GENERATION_CONFIG = {
  temperature: 0.2,
  maxOutputTokens: 2_048,
  responseMimeType: "application/json",
  responseJsonSchema: RESPONSE_JSON_SCHEMA,
  thinkingConfig: { thinkingBudget: 0 },
} as const;

export function coerceSuggestedMetadata(value: unknown): TemplateVisualMetadata | null {
  if (!value || typeof value !== "object") return null;
  const parsed = TemplateVisualMetadataSchema.safeParse({
    ...(value as Record<string, unknown>),
    reviewStatus: "unreviewed",
  });
  return parsed.success ? parsed.data : null;
}

export interface SuggestVisualMetadataOptions {
  apiKey?: string;
  modelId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface SuggestVisualMetadataAudit {
  workflowVersion: typeof VISUAL_METADATA_WORKFLOW_VERSION;
  modelChoice: {
    version: typeof VISUAL_METADATA_MODEL_CHOICE_VERSION;
    modelId: string;
  };
  promptVersion: typeof VISUAL_METADATA_PROMPT_VERSION;
  schemaVersion: typeof TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION;
  generationConfig: {
    version: typeof VISUAL_METADATA_GENERATION_CONFIG_VERSION;
    temperature: 0.2;
    maxOutputTokens: 2048;
    responseMimeType: "application/json";
    responseJsonSchemaVersion: typeof TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION;
    thinkingBudget: 0;
  };
  failurePolicy: {
    version: typeof VISUAL_METADATA_FAILURE_POLICY_VERSION;
    maximumFailureRate: number;
  };
  timeoutPolicy: {
    version: typeof VISUAL_METADATA_TIMEOUT_POLICY_VERSION;
    timeoutMs: number;
  };
}

export type SuggestVisualMetadataFailureKind =
  | "missing_key"
  | "missing_screenshot"
  | "fetch"
  | "model"
  | "parse"
  | "aborted"
  | "timeout";

export type SuggestVisualMetadataResult =
  | { ok: true; metadata: TemplateVisualMetadata; raw: string; audit: SuggestVisualMetadataAudit }
  | {
      ok: false;
      kind: SuggestVisualMetadataFailureKind;
      message: string;
      raw?: string;
      audit: SuggestVisualMetadataAudit;
    };

type CancellationKind = "aborted" | "timeout";

function createAudit(modelId: string, timeoutMs: number): SuggestVisualMetadataAudit {
  return {
    workflowVersion: VISUAL_METADATA_WORKFLOW_VERSION,
    modelChoice: { version: VISUAL_METADATA_MODEL_CHOICE_VERSION, modelId },
    promptVersion: VISUAL_METADATA_PROMPT_VERSION,
    schemaVersion: TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION,
    generationConfig: {
      version: VISUAL_METADATA_GENERATION_CONFIG_VERSION,
      temperature: GENERATION_CONFIG.temperature,
      maxOutputTokens: GENERATION_CONFIG.maxOutputTokens,
      responseMimeType: GENERATION_CONFIG.responseMimeType,
      responseJsonSchemaVersion: TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION,
      thinkingBudget: GENERATION_CONFIG.thinkingConfig.thinkingBudget,
    },
    failurePolicy: {
      version: VISUAL_METADATA_FAILURE_POLICY_VERSION,
      maximumFailureRate: VISUAL_METADATA_MAXIMUM_FAILURE_RATE,
    },
    timeoutPolicy: { version: VISUAL_METADATA_TIMEOUT_POLICY_VERSION, timeoutMs },
  };
}

function failure(
  audit: SuggestVisualMetadataAudit,
  kind: SuggestVisualMetadataFailureKind,
  message: string,
  raw?: string,
): SuggestVisualMetadataResult {
  return raw === undefined
    ? { ok: false, kind, message, audit }
    : { ok: false, kind, message, raw, audit };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedProviderText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return normalized.length <= maximumLength
    ? normalized
    : `${normalized.slice(0, maximumLength - 1)}…`;
}

async function geminiHttpErrorMessage(response: Response): Promise<string> {
  const fallback = `Gemini ${response.status}`;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return fallback;
  }
  if (!isRecord(payload) || !isRecord(payload.error)) return fallback;
  const providerStatus = boundedProviderText(payload.error.status, 64);
  const providerMessage = boundedProviderText(payload.error.message, 512);
  if (providerStatus && providerMessage) return `${fallback} ${providerStatus}: ${providerMessage}`;
  if (providerStatus) return `${fallback} ${providerStatus}`;
  return providerMessage ? `${fallback}: ${providerMessage}` : fallback;
}

function cancellationFailure(
  audit: SuggestVisualMetadataAudit,
  cancellation: CancellationKind | null,
  fallbackKind: "fetch" | "model",
  fallbackMessage: string,
): SuggestVisualMetadataResult {
  if (cancellation === "timeout") return failure(audit, "timeout", "template suggestion timed out");
  if (cancellation === "aborted") return failure(audit, "aborted", "template suggestion aborted");
  return failure(audit, fallbackKind, fallbackMessage);
}

function screenshotMimeType(response: Response): string | null {
  const contentType = response.headers.get("content-type");
  if (!contentType) return "image/jpeg";
  const mimeType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return /^image\/[a-z0-9.+-]+$/.test(mimeType) ? mimeType : null;
}

function promptFor(record: TemplateRecord): string {
  return [
    "Analyze the attached full-page template screenshot and return metadata.",
    "Describe what is visibly present, not what the template name implies.",
    "Use lowercase snake_case taxonomy tags.",
    "visualSignals are signals present in the screenshot.",
    "negativeTags are domains/audiences for which this design would be misleading.",
    "Do not mark the result reviewed; human review is mandatory.",
    `Return strict JSON matching ${TEMPLATE_VISUAL_METADATA_SCHEMA_VERSION}.`,
    "Required keys: schemaVersion, domains, audiences, ageRanges, emotionalRegisters, visualArchetypes, visualSignals, layoutTraits, requiredAssetTypes, negativeTags, supportedSiteTypes, supportedSectionRoles, themeability, identityStrength, reviewStatus.",
    "Every taxonomy collection is an array of lowercase snake_case strings. themeability and identityStrength are low|medium|high. reviewStatus is unreviewed.",
    "ageRanges examples: 5_10, 18_24, 65_plus. Never use hyphens in ageRanges.",
    `Template: ${record.name}`,
    `Family: ${record.family}`,
    `Pitch: ${record.pitch}`,
    `Description: ${record.description}`,
  ].join("\n");
}

function canonicalizeSuggestedAgeRanges(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const ageRanges = (value as Record<string, unknown>).ageRanges;
  if (!Array.isArray(ageRanges)) return value;
  const canonical = ageRanges.map((ageRange) => {
    if (typeof ageRange !== "string") return ageRange;
    const match = /^(0|[1-9]\d{0,2})-(0|[1-9]\d{0,2})$/.exec(ageRange);
    return match ? `${match[1]}_${match[2]}` : ageRange;
  });
  return { ...(value as Record<string, unknown>), ageRanges: canonical };
}

async function executeSuggestion(
  record: TemplateRecord,
  apiKey: string,
  modelId: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  audit: SuggestVisualMetadataAudit,
  cancellationState: { kind: CancellationKind | null },
): Promise<SuggestVisualMetadataResult> {
  let screenshot: Response;
  try {
    screenshot = await fetchImpl(record.screenshotUrl!, { signal });
  } catch {
    return cancellationFailure(audit, cancellationState.kind, "fetch", "screenshot request failed");
  }
  if (!screenshot.ok) {
    return failure(audit, "fetch", `screenshot ${screenshot.status}`);
  }
  const mimeType = screenshotMimeType(screenshot);
  if (!mimeType) {
    return failure(audit, "fetch", "screenshot content type is not an image");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await screenshot.arrayBuffer());
  } catch {
    return cancellationFailure(audit, cancellationState.kind, "fetch", "screenshot body unreadable");
  }

  let modelResponse: Response;
  try {
    modelResponse = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [
            { text: promptFor(record) },
            { inlineData: { mimeType, data: bytes.toString("base64") } },
          ] }],
          generationConfig: GENERATION_CONFIG,
        }),
      },
    );
  } catch {
    return cancellationFailure(audit, cancellationState.kind, "model", "Gemini request failed");
  }
  if (!modelResponse.ok) {
    return failure(audit, "model", await geminiHttpErrorMessage(modelResponse));
  }

  let payload: unknown;
  try {
    payload = await modelResponse.json();
  } catch {
    return cancellationFailure(audit, cancellationState.kind, "model", "invalid Gemini response envelope");
  }
  if (!payload || typeof payload !== "object") {
    return failure(audit, "model", "invalid Gemini response envelope");
  }
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) {
    return failure(audit, "model", "invalid Gemini response envelope");
  }
  const first = candidates[0];
  const parts = first && typeof first === "object"
    ? (first as { content?: { parts?: unknown } }).content?.parts
    : null;
  if (!Array.isArray(parts)) {
    return failure(audit, "model", "invalid Gemini response envelope");
  }
  const raw = parts
    .map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
      ? (part as { text: string }).text
      : "")
    .join("");
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gi, "").trim());
  } catch {
    return failure(audit, "parse", "malformed metadata JSON", raw);
  }
  const metadata = coerceSuggestedMetadata(canonicalizeSuggestedAgeRanges(value));
  return metadata
    ? { ok: true, metadata, raw, audit }
    : failure(audit, "parse", "metadata schema rejected model output", raw);
}

export async function suggestVisualMetadata(
  record: TemplateRecord,
  options: SuggestVisualMetadataOptions = {},
): Promise<SuggestVisualMetadataResult> {
  const modelId = options.modelId
    ?? process.env.OPENLEN_METADATA_MODEL
    ?? process.env.STYLE_MATCH_TEXT_MODEL
    ?? "gemini-2.5-flash";
  const timeoutMs = Math.max(1, options.timeoutMs ?? VISUAL_METADATA_PER_TEMPLATE_TIMEOUT_MS);
  const audit = createAudit(modelId, timeoutMs);
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return failure(audit, "missing_key", "GEMINI_API_KEY not set");
  if (!record.screenshotUrl) {
    return failure(audit, "missing_screenshot", `template ${record.id} has no screenshot`);
  }
  if (options.signal?.aborted) return failure(audit, "aborted", "template suggestion aborted");

  const controller = new AbortController();
  const cancellationState: { kind: CancellationKind | null } = { kind: null };
  let resolveCancellation!: (result: SuggestVisualMetadataResult) => void;
  const cancellation = new Promise<SuggestVisualMetadataResult>((resolve) => {
    resolveCancellation = resolve;
  });
  const cancel = (kind: CancellationKind): void => {
    if (cancellationState.kind) return;
    cancellationState.kind = kind;
    controller.abort();
    resolveCancellation(kind === "timeout"
      ? failure(audit, "timeout", "template suggestion timed out")
      : failure(audit, "aborted", "template suggestion aborted"));
  };
  const timer = setTimeout(() => cancel("timeout"), timeoutMs);
  const onAbort = (): void => cancel("aborted");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([
      executeSuggestion(record, apiKey, modelId, options.fetchImpl ?? fetch, controller.signal, audit, cancellationState),
      cancellation,
    ]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
