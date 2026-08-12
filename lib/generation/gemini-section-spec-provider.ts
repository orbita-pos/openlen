import { z } from "zod";

import { GeneratedSectionSpecSchema, type GeneratedSectionSpec } from "./generated-section-contracts";
import { SectionPlanRowSchema } from "./section-composition-contracts";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const PROMPT_VERSION = "generated-section-spec-prompt/1.0" as const;

const RequestSchema = z.object({
  role: SectionPlanRowSchema.shape.requestedRole,
  intent: z.object({
    domains: z.array(z.string().max(80)).max(12), audiences: z.array(z.string().max(80)).max(8),
    requiredSignals: z.array(z.string().max(80)).max(12), forbiddenSignals: z.array(z.string().max(80)).max(12),
  }).strict(),
  direction: z.object({
    visualArchetype: z.string().max(100), emotionalTone: z.array(z.string().max(80)).max(8),
    density: z.enum(["airy", "balanced", "dense"]),
  }).strict(),
  copyKeys: z.array(z.string().max(80)).max(32),
  assetSlots: z.array(z.object({ slotIndex: z.number().int().min(0).max(11), mediaType: z.enum(["photo", "illustration", "texture"]) }).strict()).max(12),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.copyKeys).size !== value.copyKeys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["copyKeys"], message: "copy keys must be unique" });
  if (new Set(value.assetSlots.map((slot) => slot.slotIndex)).size !== value.assetSlots.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assetSlots"], message: "asset slots must be unique" });
});

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  additionalProperties: false,
  required: ["schemaVersion", "role", "layout", "blocks", "geometry"],
  properties: {
    schemaVersion: { type: "STRING", enum: ["generated-section-spec/1.0"] },
    role: { type: "STRING" },
    layout: { type: "STRING", enum: ["split", "centered", "grid", "editorial", "gallery", "timeline", "marquee", "stacked_cards"] },
    blocks: { type: "ARRAY", minItems: 2, maxItems: 10, items: { anyOf: [
      { type: "OBJECT", additionalProperties: false, required: ["kind", "copyKey"], properties: { kind: { type: "STRING", enum: ["heading"] }, copyKey: { type: "STRING" } } },
      { type: "OBJECT", additionalProperties: false, required: ["kind", "copyKey"], properties: { kind: { type: "STRING", enum: ["body"] }, copyKey: { type: "STRING" } } },
      { type: "OBJECT", additionalProperties: false, required: ["kind", "copyKeys"], properties: { kind: { type: "STRING", enum: ["cards"] }, copyKeys: { type: "ARRAY", minItems: 2, maxItems: 8, items: { type: "STRING" } } } },
      { type: "OBJECT", additionalProperties: false, required: ["kind", "slotIndex"], properties: { kind: { type: "STRING", enum: ["media"] }, slotIndex: { type: "INTEGER", minimum: 0, maximum: 11 } } },
      { type: "OBJECT", additionalProperties: false, required: ["kind", "copyKeys"], properties: { kind: { type: "STRING", enum: ["actions"] }, copyKeys: { type: "ARRAY", minItems: 1, maxItems: 2, items: { type: "STRING" } } } },
    ] } },
    geometry: {
      type: "OBJECT", additionalProperties: false, required: ["density", "emphasis"],
      properties: { density: { type: "STRING", enum: ["airy", "balanced", "dense"] }, emphasis: { type: "STRING", enum: ["copy", "media", "balanced"] } },
    },
  },
} as const;

export type GeneratedSectionSpecRequest = z.infer<typeof RequestSchema>;
export interface GeneratedSectionSpecUsage { inputTokens: number; outputTokens: number; thinkingTokens: number; cachedTokens: number }
export type GeneratedSectionSpecProviderResult =
  | { ok: true; spec: GeneratedSectionSpec; modelId: string; promptVersion: typeof PROMPT_VERSION; usage?: GeneratedSectionSpecUsage; durationMs: number }
  | { ok: false; code: "missing_key" | "timeout" | "http" | "provider" | "invalid_json" | "schema" | "future_version"; modelId: string; promptVersion: typeof PROMPT_VERSION; usage?: GeneratedSectionSpecUsage; durationMs: number };
export interface GeneratedSectionSpecProvider { generate(request: GeneratedSectionSpecRequest): Promise<GeneratedSectionSpecProviderResult> }

interface Options { apiKey?: string; modelId?: string; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number }

function modelId(...values: Array<string | undefined>): string {
  for (const value of values) { const trimmed = value?.trim(); if (trimmed && MODEL_ID.test(trimmed)) return trimmed; }
  return DEFAULT_MODEL;
}
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function token(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function usage(value: unknown): GeneratedSectionSpecUsage | undefined {
  const root = record(value); const data = record(root?.usageMetadata);
  if (!data) return undefined;
  const inputTokens = token(data.promptTokenCount); const outputTokens = token(data.candidatesTokenCount);
  const thinkingTokens = data.thoughtsTokenCount === undefined ? 0 : token(data.thoughtsTokenCount);
  const cachedTokens = data.cachedContentTokenCount === undefined ? 0 : token(data.cachedContentTokenCount);
  return inputTokens === null || outputTokens === null || thinkingTokens === null || cachedTokens === null
    ? undefined : { inputTokens, outputTokens, thinkingTokens, cachedTokens };
}
function textFromEnvelope(value: unknown): string | null {
  const root = record(value); const candidates = root && Array.isArray(root.candidates) ? root.candidates : null;
  if (!candidates || candidates.length !== 1) return null;
  const candidate = record(candidates[0]); const content = record(candidate?.content);
  if (!candidate || candidate.finishReason !== "STOP" || !content || !Array.isArray(content.parts) || content.parts.length !== 1) return null;
  const part = record(content.parts[0]); return typeof part?.text === "string" ? part.text : null;
}
function elapsed(started: number, now: () => number): number { return Math.max(0, Math.floor(now() - started)); }

export function createGeminiSectionSpecProvider(options: Options = {}): GeneratedSectionSpecProvider {
  const env = options.env ?? process.env; const apiKey = options.apiKey ?? env.GEMINI_API_KEY;
  const selectedModel = modelId(options.modelId, env.OPENLEN_SECTION_SPEC_MODEL, DEFAULT_MODEL);
  const fetchImpl = options.fetchImpl ?? fetch; const now = options.now ?? Date.now;
  const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0 ? Math.floor(Number(options.timeoutMs)) : 15_000;
  const fail = (code: Extract<GeneratedSectionSpecProviderResult, { ok: false }>["code"], started: number, safeUsage?: GeneratedSectionSpecUsage): GeneratedSectionSpecProviderResult => ({
    ok: false, code, modelId: selectedModel, promptVersion: PROMPT_VERSION, ...(safeUsage ? { usage: safeUsage } : {}), durationMs: elapsed(started, now),
  });
  return { async generate(request) {
    const started = now(); if (!apiKey) return fail("missing_key", started);
    const parsedRequest = RequestSchema.safeParse(request); if (!parsedRequest.success) return fail("schema", started);
    const controller = new AbortController(); let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(`${BASE}/${selectedModel}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: "Return one strict generated-section-spec/1.0 JSON object. Never emit HTML, CSS, JS, URLs, selectors, or copy values. Use only supplied copy keys and asset slots." }] },
          contents: [{ role: "user", parts: [{ text: JSON.stringify(parsedRequest.data) }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: 0, candidateCount: 1 },
        }),
      });
      if (!response.ok) return fail("http", started);
      let payload: unknown;
      let bodyTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        payload = await Promise.race([
          response.json(),
          new Promise<never>((_resolve, reject) => {
            bodyTimer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error("body_timeout")); }, timeoutMs);
          }),
        ]);
      } catch {
        return fail(timedOut || controller.signal.aborted ? "timeout" : "provider", started);
      } finally {
        if (bodyTimer !== undefined) clearTimeout(bodyTimer);
      }
      const safeUsage = usage(payload); const text = textFromEnvelope(payload);
      if (text === null) return fail("provider", started, safeUsage);
      let decoded: unknown;
      try { decoded = JSON.parse(text); } catch { return fail("invalid_json", started, safeUsage); }
      const decodedRecord = record(decoded);
      if (decodedRecord?.schemaVersion !== undefined && decodedRecord.schemaVersion !== "generated-section-spec/1.0") return fail("future_version", started, safeUsage);
      const spec = GeneratedSectionSpecSchema.safeParse(decoded); if (!spec.success) return fail("schema", started, safeUsage);
      return { ok: true, spec: spec.data, modelId: selectedModel, promptVersion: PROMPT_VERSION, ...(safeUsage ? { usage: safeUsage } : {}), durationMs: elapsed(started, now) };
    } catch {
      return fail(timedOut || controller.signal.aborted ? "timeout" : "provider", started);
    } finally { clearTimeout(timer); }
  } };
}
