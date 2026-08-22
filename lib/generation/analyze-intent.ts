import { IntentAnalysisSchema, type IntentAnalysis } from "./contracts";
import type { ModelTokenUsage } from "./model-cost";
import { modelIdForRole } from "./fable-model-policy";
import {
  CANONICAL_PRIMARY_AUDIENCES,
  CANONICAL_SECTION_ROLES,
  CANONICAL_SITE_TYPES,
} from "./structural-taxonomy";

const FIREWORKS_ENDPOINT = "https://api.fireworks.ai/inference/v1/chat/completions";

export const INTENT_PROMPT_VERSION = "intent-prompt/1.8" as const;
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

const GENERATION_CONFIG = {
  temperature: 0,
  maxOutputTokens: 2_048,
  responseMimeType: "application/json",
  thinkingConfig: { thinkingBudget: 0 },
} as const;

export const INTENT_SYSTEM_PROMPT = `You are OpenLen's product-intent analyst.
Analyze the user's actual product. Never force it into a nearby template category.

Separate functional requirements from visual and emotional identity:
- functional describes sections, actions, site type, and content model;
- audience, domains, emotionalGoals, and visual signals describe what the rendered product must communicate before its copy is read.

Do not infer a visual category merely because two products share sections. Galleries, stories, progress, cards, forms, and navigation are structural features, not proof of an education, SaaS, corporate, editorial, or children's identity.
Use lowercase snake_case taxonomy tags. Record genuine uncertainty in ambiguities instead of applying a generic SaaS or education default.
For functional.siteType, use exactly one of: ${CANONICAL_SITE_TYPES.join(", ")}.
For audience.primary, use exactly one of: ${CANONICAL_PRIMARY_AUDIENCES.join(", ")}.
For functional.requiredSections, use only these roles: ${CANONICAL_SECTION_ROLES.join(", ")}.
Use canonical structural values instead of synonyms. Omit an unsupported section role and record the unsupported requirement as a concrete ambiguity; never invent a nearest role. Keep wrapper roles such as header, hero, call_to_action, and footer when the brief requires a complete page.
Structural category guidance: public cafe, bakery, wine bar, taqueria, or restaurant -> restaurant; appointment-based or membership-based local wellness studio -> small_business; software product marketing -> saas_product_page; open-source product promotion -> product_landing_page; creator link or resource page -> creator_hub; personal work showcase -> portfolio; teaching-resource library -> educational_resource; documentation -> documentation_site; issue archive with membership CTA -> blog; signup-first publication without an issue archive -> newsletter.
Role boundaries: stories and testimonials are different roles; minigames and activities are different roles; a coloring_gallery is not proof of an educational product.
For common product domains, use these canonical labels whenever they apply; do not replace them with a narrower synonym: children_entertainment, creative_play, education, local_services, developer_tools, ai_ml, food_beverage, hospitality, wellness, healthcare, fintech, portfolio, illustration, agency, gaming, sports, wedding, nonprofit, fashion, ecommerce, real_estate, hardware, consumer_technology, editorial, publishing, legal_services, logistics, business_services, science, music, photography, coworking, government, events, beauty, construction. Include every applicable canonical domain, then add a narrower tag only if useful.
Canonical multi-domain decision: preschool -> education + local_services.
Taxonomy semantics: local_services applies to a place-based or appointment-based provider serving a geographic community, even when it also serves businesses; portfolio applies to an individual creator whose work is a primary reason to visit the site. Include these facets in addition to the specialist domain rather than replacing it.
Primary audience must use one of these broad canonical labels whenever it applies: children, parents, adults, developers, consumers, families, professionals, educators, creative_clients, businesses, gamers, fans, guests, donors, home_buyers, readers, citizens, homeowners. Put narrower groups such as adult_learners or coffee_enthusiasts in audience.secondary; do not replace the broad primary label with them. Canonical visual-audience decisions: child-focused creative club -> children, with parents or families in audience.secondary when registration is adult-mediated; art educator creator hub -> educators.
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
Set requestedImages only when the brief itself asks for photography and says how much: a plain number for "four photos", the number of sections for "one image per section", the upper end for "four or five". Use null when the brief is silent about imagery, and 0 when it asks for none. Never infer a count from the niche.

Return keys exactly as follows: schemaVersion, language, functional { siteType, requiredSections, primaryActions, contentModel }, audience { primary, ageRange, secondary }, domains, emotionalGoals, requiredVisualSignals, forbiddenVisualSignals, explicitConstraints, ambiguities, confidence.
schemaVersion must be the exact literal string "intent-analysis/1.0", not "1.0" or any other shorthand.
functional.contentModel must be one lowercase snake_case string, never an array, object, boolean, number, or null.
All taxonomy values are lowercase snake_case strings. confidence is a number from 0 to 1. ageRange is a lowercase snake_case range such as 5_10 only when the brief supports a concrete range; otherwise use null.
The JSON shape is exactly: {"schemaVersion":"intent-analysis/1.0","language":"en","functional":{"siteType":"business","requiredSections":[],"primaryActions":[],"contentModel":"descriptive_content_model"},"audience":{"primary":"consumers","ageRange":null,"secondary":[]},"domains":[],"emotionalGoals":[],"requiredVisualSignals":[],"forbiddenVisualSignals":[],"explicitConstraints":[],"ambiguities":[],"confidence":0.9}.
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

function optionalZeroTokenCount(value: unknown): number | null {
  if (value === undefined) return 0;
  return validTokenCount(value) ? value : null;
}

function readUsageMetadata(payload: unknown): IntentModelUsage | undefined {
  // Forma de OpenAI (`usage.prompt_tokens`), que es la que devuelve el endpoint
  // compatible de Fireworks. Antes era la de Gemini (`usageMetadata`).
  if (!isRecord(payload) || !isRecord(payload.usage)) return undefined;
  const metadata = payload.usage;
  const cachedTokens = optionalZeroTokenCount(
    isRecord(metadata.prompt_tokens_details) ? metadata.prompt_tokens_details.cached_tokens : undefined,
  );
  const thinkingTokens = optionalZeroTokenCount(
    isRecord(metadata.completion_tokens_details) ? metadata.completion_tokens_details.reasoning_tokens : undefined,
  );
  if (!validTokenCount(metadata.prompt_tokens)
    || !validTokenCount(metadata.completion_tokens)
    || cachedTokens === null
    || thinkingTokens === null) return undefined;
  return {
    inputTokens: metadata.prompt_tokens,
    outputTokens: metadata.completion_tokens,
    cachedTokens,
    thinkingTokens,
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

const CANONICAL_SITE_TYPE_SET = new Set<string>(CANONICAL_SITE_TYPES);
const CANONICAL_PRIMARY_AUDIENCE_SET = new Set<string>(CANONICAL_PRIMARY_AUDIENCES);
const CANONICAL_SECTION_ROLE_SET = new Set<string>(CANONICAL_SECTION_ROLES);

function hasNoncanonicalStructure(intent: IntentAnalysis): boolean {
  return !CANONICAL_SITE_TYPE_SET.has(intent.functional.siteType)
    || !CANONICAL_PRIMARY_AUDIENCE_SET.has(intent.audience.primary)
    || intent.functional.requiredSections.some(
      (section) => !CANONICAL_SECTION_ROLE_SET.has(section),
    );
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
    // Analizar un brief es TEXTO: lo lee DeepSeek, por el endpoint compatible
    // con OpenAI de Fireworks. Gemini se queda para los píxeles.
    //
    // Se conserva `fetchImpl` a propósito: es la costura que hace comprobable
    // este módulo, y cambiarla por el cliente de streaming habría obligado a
    // reescribir sus 15 casos por una diferencia que no llega a nadie.
    response = await fetchImpl(
      FIREWORKS_ENDPOINT,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        signal,
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: "system", content: INTENT_SYSTEM_PROMPT },
            { role: "user", content: `Brief:\n\n${brief.trim()}\n\nReturn intent JSON only.` },
          ],
          temperature: GENERATION_CONFIG.temperature,
          max_tokens: GENERATION_CONFIG.maxOutputTokens,
          response_format: { type: "json_object" },
        }),
      },
    );
  } catch {
    const kind = cancellation.kind ?? "api";
    const message = kind === "timeout"
      ? "intent analysis timed out"
      : kind === "aborted"
        ? "intent analysis aborted"
        : "model request failed";
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
        message: response.ok ? "invalid model response envelope" : `modelo ${response.status}`,
      },
      durationMs: elapsed(),
    };
  }
  if (!response.ok) {
    const usage = readUsageMetadata(payload);
    return {
      ok: false,
      ...base,
      error: { kind: "api", message: `modelo ${response.status}` },
      ...(usage ? { usage } : {}),
      durationMs: elapsed(),
    };
  }
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return {
      ok: false,
      ...base,
      error: { kind: "api", message: "invalid model response envelope" },
      durationMs: elapsed(),
    };
  }
  const first = payload.choices[0];
  const content = isRecord(first) && isRecord(first.message) ? first.message.content : null;
  if (typeof content !== "string") {
    return {
      ok: false,
      ...base,
      error: { kind: "api", message: "invalid model response envelope" },
      durationMs: elapsed(),
    };
  }
  const usage = readUsageMetadata(payload);
  const raw = content;

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
  if (hasNoncanonicalStructure(validated.data)) {
    return {
      ok: false,
      ...base,
      error: { kind: "schema", message: "intent structural taxonomy mismatch" },
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
    // El razonador: leer un brief es texto.
    ?? modelIdForRole("reasoner");
  const base = { modelId, promptVersion: INTENT_PROMPT_VERSION };
  if (!brief.trim()) {
    return {
      ok: false,
      ...base,
      error: { kind: "invalid_input", message: "brief is required" },
      durationMs: elapsed(),
    };
  }
  const apiKey = options.apiKey ?? process.env.FIREWORKS_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      ...base,
      error: { kind: "missing_key", message: "FIREWORKS_API_KEY not set" },
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
