import { IntentAnalysisSchema, type IntentAnalysis } from "./contracts";
import type { ModelTokenUsage } from "./model-cost";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const INTENT_PROMPT_VERSION = "intent-prompt/1.5" as const;
export const INTENT_ANALYSIS_TIMEOUT_MS = 12_000;

export const CANONICAL_FORBIDDEN_VISUAL_SIGNALS = Object.freeze([
  "saas_dashboard",
  "course_progress_ui",
  "corporate_photography",
  "luxury_editorial",
  "children_toy_ui",
  "gaming_esports",
  "nightclub",
  "wellness_organic",
  "medical_clinical",
  "developer_terminal",
  "corporate_dashboard",
  "restaurant_menu",
  "luxury_beauty",
  "ecommerce_storefront",
]);

const TAXONOMY_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "string" },
  maxItems: 24,
} as const;

const PROSE_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "string", minLength: 1, maxLength: 240 },
  maxItems: 12,
} as const;

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", enum: ["intent-analysis/1.0"] },
    language: { type: "string" },
    functional: {
      type: "object",
      additionalProperties: false,
      properties: {
        siteType: { type: "string" },
        requiredSections: TAXONOMY_ARRAY_SCHEMA,
        primaryActions: TAXONOMY_ARRAY_SCHEMA,
        contentModel: { type: "string" },
      },
      required: ["siteType", "requiredSections", "primaryActions", "contentModel"],
    },
    audience: {
      type: "object",
      additionalProperties: false,
      properties: {
        primary: { type: "string" },
        ageRange: { type: ["string", "null"] },
        secondary: TAXONOMY_ARRAY_SCHEMA,
      },
      required: ["primary", "ageRange", "secondary"],
    },
    domains: { ...TAXONOMY_ARRAY_SCHEMA, minItems: 1 },
    emotionalGoals: TAXONOMY_ARRAY_SCHEMA,
    requiredVisualSignals: TAXONOMY_ARRAY_SCHEMA,
    forbiddenVisualSignals: TAXONOMY_ARRAY_SCHEMA,
    explicitConstraints: PROSE_ARRAY_SCHEMA,
    ambiguities: PROSE_ARRAY_SCHEMA,
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "schemaVersion",
    "language",
    "functional",
    "audience",
    "domains",
    "emotionalGoals",
    "requiredVisualSignals",
    "forbiddenVisualSignals",
    "explicitConstraints",
    "ambiguities",
    "confidence",
  ],
} as const;

const GENERATION_CONFIG = {
  temperature: 0.2,
  maxOutputTokens: 2_048,
  responseMimeType: "application/json",
  responseJsonSchema: RESPONSE_JSON_SCHEMA,
  thinkingConfig: { thinkingBudget: 0 },
} as const;

export const INTENT_SYSTEM_PROMPT = `You are OpenLen's product-intent analyst.
Analyze the user's actual product. Never force it into a nearby template category.

Separate functional requirements from visual and emotional identity:
- functional describes sections, actions, site type, and content model;
- audience, domains, emotionalGoals, and visual signals describe what the rendered product must communicate before its copy is read.

Do not infer a visual category merely because two products share sections. Galleries, stories, progress, cards, forms, and navigation are structural features, not proof of an education, SaaS, corporate, editorial, or children's identity.
Use lowercase snake_case taxonomy tags. Record genuine uncertainty in ambiguities instead of applying a generic SaaS or education default.
For common product domains, use these canonical labels whenever they apply; do not replace them with a narrower synonym: children_entertainment, creative_play, education, local_services, developer_tools, ai_ml, food_beverage, hospitality, wellness, healthcare, fintech, portfolio, illustration, agency, gaming, sports, wedding, nonprofit, fashion, ecommerce, real_estate, hardware, consumer_technology, editorial, publishing, legal_services, logistics, business_services, science, music, photography, coworking, government, events, beauty, construction. Include every applicable canonical domain, then add a narrower tag only if useful.
Canonical multi-domain decision: preschool -> education + local_services.
Taxonomy semantics: local_services applies to a place-based or appointment-based provider serving a geographic community, even when it also serves businesses; portfolio applies to an individual creator whose work is a primary reason to visit the site. Include these facets in addition to the specialist domain rather than replacing it.
Primary audience must use one of these broad canonical labels whenever it applies: children, parents, adults, developers, consumers, families, professionals, creative_clients, businesses, gamers, fans, guests, donors, home_buyers, readers, citizens, homeowners. Put narrower groups such as adult_learners or coffee_enthusiasts in audience.secondary; do not replace the broad primary label with them.
Canonical primary-audience decisions: preschool or school admissions for families -> parents; restaurant or hospitality for the public -> consumers; a design agency selling services to companies -> businesses; a nonprofit centered on donations -> donors; an individual artist portfolio -> creative_clients; wellness classes or retreats for adults -> adults; real-estate listings or brokerage -> home_buyers.
The canonical forbidden visual-signal vocabulary includes: ${CANONICAL_FORBIDDEN_VISUAL_SIGNALS.join(", ")}. For forbiddenVisualSignals, include every canonical signal from this list that would make the requested product visibly communicate the wrong domain, audience, or emotional tone. Do not use a near-synonym when a canonical signal applies.
Use these reviewed contrast profiles when the category applies:
- children coloring or minigames -> saas_dashboard + course_progress_ui + corporate_photography;
- illustrated children's stories or drawing club -> saas_dashboard + luxury_editorial;
- adult language education -> children_toy_ui + gaming_esports;
- preschool admissions -> saas_dashboard + nightclub;
- developer tools or AI observability -> children_toy_ui + wellness_organic;
- food_beverage retail or coffee -> saas_dashboard + medical_clinical;
- restaurant or hospitality -> developer_terminal + course_progress_ui;
- wellness studio -> gaming_esports + corporate_dashboard;
- family healthcare or dentist -> saas_dashboard + nightclub;
- fintech -> children_toy_ui + restaurant_menu;
- artist portfolio -> saas_dashboard + course_progress_ui;
- design agency -> children_toy_ui + medical_clinical;
- gaming -> course_progress_ui + corporate_photography;
- sports club -> saas_dashboard + luxury_beauty;
- wedding -> saas_dashboard + gaming_esports;
- nonprofit -> ecommerce_storefront + gaming_esports;
- fashion ecommerce -> saas_dashboard + developer_terminal;
- real estate -> course_progress_ui + children_toy_ui;
- consumer hardware -> restaurant_menu + children_toy_ui;
- editorial publishing -> saas_dashboard + course_progress_ui.
When a reviewed contrast profile applies, return exactly those 2 profile signals, except the children-coloring profile which intentionally has 3. Without a matching profile, return 2 to 4 diagnostic forbidden signals. Never copy the whole vocabulary.
When the brief does not support a required classification, use the exact slug unknown rather than guessing. An intent containing unknown must include a concrete ambiguity and confidence at or below 0.49. Use null for an unknown ageRange and empty arrays for unsupported optional lists.
requiredVisualSignals are concrete cues the finished screenshot must visibly contain.
forbiddenVisualSignals are concrete cues that would make the screenshot communicate the wrong domain, audience, or emotion.
Preserve explicit user constraints as concise prose in explicitConstraints. Do not invent requirements the brief does not support.

Return keys exactly as follows: schemaVersion, language, functional { siteType, requiredSections, primaryActions, contentModel }, audience { primary, ageRange, secondary }, domains, emotionalGoals, requiredVisualSignals, forbiddenVisualSignals, explicitConstraints, ambiguities, confidence.
All taxonomy values are lowercase snake_case strings. confidence is a number from 0 to 1. ageRange is a lowercase snake_case range such as 5_10 or null.
Return strict JSON matching intent-analysis/1.0 and no prose.`;

export interface AnalyzeIntentOptions {
  apiKey?: string;
  modelId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export type AnalyzeIntentFailureKind =
  | "missing_key"
  | "api"
  | "parse"
  | "schema"
  | "aborted"
  | "timeout"
  | "invalid_input";

export type IntentModelUsage = ModelTokenUsage;

export type AnalyzeIntentResult =
  | {
      ok: true;
      intent: IntentAnalysis;
      modelId: string;
      promptVersion: typeof INTENT_PROMPT_VERSION;
      usage?: IntentModelUsage;
      durationMs: number;
    }
  | {
      ok: false;
      error: { kind: AnalyzeIntentFailureKind; message: string };
      modelId: string;
      promptVersion: typeof INTENT_PROMPT_VERSION;
      usage?: IntentModelUsage;
      durationMs: number;
    };

function stripFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readUsageMetadata(payload: unknown): IntentModelUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usageMetadata)) return undefined;
  const metadata = payload.usageMetadata;
  if (!validTokenCount(metadata.promptTokenCount)
    || !validTokenCount(metadata.candidatesTokenCount)
    || !validTokenCount(metadata.cachedContentTokenCount)
    || !validTokenCount(metadata.thoughtsTokenCount)) return undefined;
  return {
    inputTokens: metadata.promptTokenCount,
    outputTokens: metadata.candidatesTokenCount,
    cachedTokens: metadata.cachedContentTokenCount,
    thinkingTokens: metadata.thoughtsTokenCount,
  };
}

function duration(started: number, now: () => number): number {
  return Math.max(0, now() - started);
}

function timeoutMilliseconds(value: number | undefined): number {
  if (value === undefined) return INTENT_ANALYSIS_TIMEOUT_MS;
  return Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : INTENT_ANALYSIS_TIMEOUT_MS;
}

function unsafeUnknownIntent(intent: IntentAnalysis): boolean {
  const hasUnknown = intent.functional.siteType === "unknown"
    || intent.functional.contentModel === "unknown"
    || intent.audience.primary === "unknown"
    || intent.domains.includes("unknown");
  return hasUnknown && (intent.ambiguities.length === 0 || intent.confidence > 0.49);
}

async function requestIntent(
  brief: string,
  apiKey: string,
  modelId: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  cancellation: { kind: "aborted" | "timeout" | null },
  base: { modelId: string; promptVersion: typeof INTENT_PROMPT_VERSION },
  elapsed: () => number,
): Promise<AnalyzeIntentResult> {
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
          systemInstruction: { parts: [{ text: INTENT_SYSTEM_PROMPT }] },
          contents: [{
            role: "user",
            parts: [{ text: `Brief:\n\n${brief.trim()}\n\nReturn intent JSON only.` }],
          }],
          generationConfig: GENERATION_CONFIG,
        }),
      },
    );
  } catch {
    const kind = cancellation.kind ?? "api";
    const message = kind === "timeout"
      ? "intent analysis timed out"
      : kind === "aborted"
        ? "intent analysis aborted"
        : "Gemini request failed";
    return { ok: false, ...base, error: { kind, message }, durationMs: elapsed() };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      ...base,
      error: {
        kind: "api",
        message: response.ok ? "invalid Gemini response envelope" : `Gemini ${response.status}`,
      },
      durationMs: elapsed(),
    };
  }
  if (!response.ok) {
    const usage = readUsageMetadata(payload);
    return {
      ok: false,
      ...base,
      error: { kind: "api", message: `Gemini ${response.status}` },
      ...(usage ? { usage } : {}),
      durationMs: elapsed(),
    };
  }
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    return {
      ok: false,
      ...base,
      error: { kind: "api", message: "invalid Gemini response envelope" },
      durationMs: elapsed(),
    };
  }
  const first = payload.candidates[0];
  const parts = isRecord(first) && isRecord(first.content) && Array.isArray(first.content.parts)
    ? first.content.parts
    : null;
  if (!parts) {
    return {
      ok: false,
      ...base,
      error: { kind: "api", message: "invalid Gemini response envelope" },
      durationMs: elapsed(),
    };
  }
  const usage = readUsageMetadata(payload);
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
      error: { kind: "parse", message: "malformed intent JSON" },
      ...(usage ? { usage } : {}),
      durationMs: elapsed(),
    };
  }
  const validated = IntentAnalysisSchema.safeParse(parsed);
  if (!validated.success) {
    const message = validated.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(" | ");
    return {
      ok: false,
      ...base,
      error: { kind: "schema", message },
      ...(usage ? { usage } : {}),
      durationMs: elapsed(),
    };
  }
  if (unsafeUnknownIntent(validated.data)) {
    return {
      ok: false,
      ...base,
      error: {
        kind: "schema",
        message: "unknown classifications require an ambiguity and confidence <= 0.49",
      },
      ...(usage ? { usage } : {}),
      durationMs: elapsed(),
    };
  }
  return {
    ok: true,
    ...base,
    intent: validated.data,
    ...(usage ? { usage } : {}),
    durationMs: elapsed(),
  };
}

export async function analyzeIntent(
  brief: string,
  options: AnalyzeIntentOptions = {},
): Promise<AnalyzeIntentResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const elapsed = () => duration(started, now);
  const modelId = options.modelId
    ?? process.env.OPENLEN_INTENT_MODEL
    ?? process.env.CURATE_PICK_MODEL
    ?? process.env.STYLE_MATCH_TEXT_MODEL
    ?? "gemini-2.5-flash";
  const base = { modelId, promptVersion: INTENT_PROMPT_VERSION };
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
      error: { kind: "aborted", message: "intent analysis aborted" },
      durationMs: elapsed(),
    };
  }

  const controller = new AbortController();
  const cancellation: { kind: "aborted" | "timeout" | null } = { kind: null };
  let resolveCancellation!: (value: AnalyzeIntentResult) => void;
  const cancelled = new Promise<AnalyzeIntentResult>((resolve) => {
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
        message: kind === "timeout" ? "intent analysis timed out" : "intent analysis aborted",
      },
      durationMs: elapsed(),
    });
  };
  const timeoutMs = timeoutMilliseconds(options.timeoutMs);
  const timer = setTimeout(() => cancel("timeout"), timeoutMs);
  const onAbort = () => cancel("aborted");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([
      requestIntent(
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
