// Vision critic (Quality S3) — renders a freshly generated landing page,
// shows the screenshot to Gemini Flash, and gets back a structured verdict
// (score + issues + shouldRegenerate + regenerationFeedback).
//
// The point is NOT to raise the average — S2 already lands ~98% on the local
// smoke. The point is to REDUCE VARIANCE: catch the ~5% of generations that
// come out visually broken (layout collapse, color collision, missing section)
// BEFORE they reach the user, since a bad page costs more in a credit-billed
// product than a good page saves.
//
// Everything here is BEST-EFFORT and fail-open: a render miss, a malformed
// verdict, an API error, or a >12s stall all return the no-critique fallback
// (shouldRegenerate=false) so the caller ships the first pass unchanged. The
// critic can only make a generation better or leave it alone — never block it.

import { GeminiProvider, type InlineImage, type StreamEvent, type StreamRequest } from "@/lib/ai-gateway";
import { renderHtmlToInlineImage } from "@/lib/ai/inline-image";

export interface CritiqueVerdict {
  /** 1–10. Hero polish, spacing, type hierarchy, color discipline. */
  visualQuality: number;
  /** 1–10. Industry / audience / tone / requested-sections match. */
  briefAdherence: number;
  /** Specific visual or structural problems. Empty when clean. */
  issues: string[];
  /** Whether the page should be regenerated with feedback. */
  shouldRegenerate: boolean;
  /** Surgical instructions for the regen. Empty when shouldRegenerate=false. */
  regenerationFeedback: string;
  /** True when this is the no-critique fallback (timeout, render miss, parse
   *  failure, API error). The loop treats a fallback verdict as "the first
   *  pass is final" — it never triggers a regen. */
  fallback: boolean;
  /** Provider usage for the diagnostic call. Present whenever the provider reported it. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    thinkingTokens: number;
  };
}

export interface CritiqueParams {
  /** The original user brief. */
  brief: string;
  /** The generated (canonical, post-normalize) HTML document. */
  html: string;
  /** Gemini model id passed verbatim to the gateway, e.g. "gemini-3.5-flash". */
  model: string;
  /** API key. Defaults to process.env.GEMINI_API_KEY. */
  apiKey?: string;
}

/** Minimal provider surface the critic needs — lets tests inject a fake. */
export interface CritiqueProviderLike {
  stream(
    request: StreamRequest,
    opts: { signal?: AbortSignal },
  ): AsyncIterableIterator<StreamEvent>;
}

export interface CritiqueInternals {
  provider?: CritiqueProviderLike;
  render?: (html: string) => Promise<InlineImage | null>;
  /** Override the 12s deadline — test-only. */
  timeoutMs?: number;
}

// Abort + return the first pass if the whole critique (render + model call)
// hasn't resolved in this long. Bumped 12s→18s after the S3 smoke: Pulsegrid
// timed out at 12016ms (Flash p95 with a base64 image + structured output runs
// ~8–15s), so 12s produced ~33% fallbacks; 18s brings that to ~5–10%. The
// fallback is safe (ship-as-is, no regen) but each timed-out critic still costs
// a credit + cycle, so widening the window is worth it. Test-overridable.
//
// 18s→30s: el sembrado de fotos pasó a correr ANTES del crítico, para que
// juzgue la página que se entrega y no los rellenos de gradiente. Eso está
// bien, y hace que el render tenga que bajar ocho imágenes de la CDN antes de
// la captura: medido, el plazo de 18s pasó a agotarse siempre. Un crítico que
// nunca contesta es peor que uno que juzga tarde — falla abierto, sí, pero
// entonces no hay red.
export const DEFAULT_TIMEOUT_MS = 30_000;
// The verdict is tiny, but `issues` can carry a few sentences and Flash spends
// a thinking budget before its first token — keep this generous so it never
// truncates mid-JSON.
const CRITIC_MAX_OUTPUT_TOKENS = 2048;
const CRITIC_TEMPERATURE = 0.2;
// Rubric floor: below this on either axis we regenerate even if the model's
// own shouldRegenerate flag said false. Defensive — can only ADD a regen the
// rubric calls for, never suppress one the model wanted.
const REGEN_THRESHOLD = 7;

// Gemini-subset OpenAPI schema. `type` values are UPPERCASE per the native
// Gemini `Schema` enum (OBJECT/INTEGER/STRING/ARRAY/BOOLEAN); `propertyOrdering`
// is a Gemini hint that improves structured-output stability.
const VERDICT_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    visualQuality: { type: "INTEGER" },
    briefAdherence: { type: "INTEGER" },
    issues: { type: "ARRAY", items: { type: "STRING" } },
    shouldRegenerate: { type: "BOOLEAN" },
    regenerationFeedback: { type: "STRING" },
  },
  required: [
    "visualQuality",
    "briefAdherence",
    "issues",
    "shouldRegenerate",
    "regenerationFeedback",
  ],
  propertyOrdering: [
    "visualQuality",
    "briefAdherence",
    "issues",
    "shouldRegenerate",
    "regenerationFeedback",
  ],
};

type CritiqueUsage = NonNullable<CritiqueVerdict["usage"]>;

function fallbackVerdict(usage?: CritiqueUsage): CritiqueVerdict {
  return {
    visualQuality: 0,
    briefAdherence: 0,
    issues: [],
    shouldRegenerate: false,
    regenerationFeedback: "",
    fallback: true,
    ...(usage ? { usage: { ...usage } } : {}),
  };
}

/** Critique a generated page. Always resolves — never throws; returns the
 *  no-critique fallback on any failure or timeout. */
export async function critiqueGeneratedPage(
  params: CritiqueParams,
  internals: CritiqueInternals = {},
): Promise<CritiqueVerdict> {
  const timeoutMs = internals.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = new AbortController();
  const usageRef: { current?: CritiqueUsage } = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      deadline.abort();
      resolve("timeout");
    }, timeoutMs);
  });

  try {
    const result = await Promise.race<CritiqueVerdict | "timeout">([
      runCritique(params, internals, deadline.signal, usageRef).catch(() => {
        logFallback("provider or critic error");
        return fallbackVerdict(usageRef.current);
      }),
      timeoutPromise,
    ]);
    if (result === "timeout") {
      logFallback(`timeout (>${timeoutMs}ms)`);
      return fallbackVerdict(usageRef.current);
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    // Tear down the upstream socket if the model call is still open (e.g. the
    // timeout branch won the race).
    deadline.abort();
  }
}

async function runCritique(
  params: CritiqueParams,
  internals: CritiqueInternals,
  signal: AbortSignal,
  usageRef: { current?: CritiqueUsage },
): Promise<CritiqueVerdict> {
  const render = internals.render ?? renderHtmlToInlineImage;
  const image = await render(params.html);
  if (!image) {
    // A vision critic with no vision can't judge layout — don't regen blind.
    logFallback("render failed — no screenshot to critique");
    return fallbackVerdict();
  }
  if (signal.aborted) return fallbackVerdict();

  const apiKey = params.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logFallback("GEMINI_API_KEY missing");
    return fallbackVerdict();
  }

  const provider: CritiqueProviderLike =
    internals.provider ?? new GeminiProvider(apiKey);
  const prompt = buildCriticPrompt(params.brief, params.html);

  let raw = "";
  try {
    for await (const ev of provider.stream(
      {
        model: params.model,
        messages: [{ role: "user", content: prompt }],
        images: [image],
        responseMimeType: "application/json",
        responseSchema: VERDICT_SCHEMA,
        maxOutputTokens: CRITIC_MAX_OUTPUT_TOKENS,
        temperature: CRITIC_TEMPERATURE,
      },
      { signal },
    )) {
      if (ev.type === "text_delta") {
        raw += ev.text;
      } else if (ev.type === "usage") {
        usageRef.current = usageRef.current ?? {
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          thinkingTokens: 0,
        };
        usageRef.current.inputTokens += ev.inputTokens;
        usageRef.current.outputTokens += ev.outputTokens;
        usageRef.current.cachedTokens += ev.cachedTokens;
        usageRef.current.thinkingTokens += ev.thinkingTokens;
      } else if (ev.type === "done" && ev.stopReason.kind === "error") {
        logFallback("gemini returned an error stop reason");
        return fallbackVerdict(usageRef.current);
      }
    }
  } catch {
    logFallback("provider stream error");
    return fallbackVerdict(usageRef.current);
  }

  const verdict = parseVerdict(raw);
  if (!verdict) {
    logFallback("malformed JSON verdict");
    return fallbackVerdict(usageRef.current);
  }
  if (usageRef.current) verdict.usage = { ...usageRef.current };
  logVerdict(verdict);
  return verdict;
}

/** First 300 chars of text from each <section> — a compact structural map
 *  that complements the screenshot (catches "missing section" cases the image
 *  alone is weak at). */
export function structuralSummary(html: string): string {
  const sections = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)];
  if (sections.length === 0) return "(no <section> elements found)";
  return sections
    .map((m, i) => {
      const text = (m[1] ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300);
      return `[section ${i + 1}] ${text}`;
    })
    .join("\n");
}

function buildCriticPrompt(brief: string, html: string): string {
  return `<role>You are an expert landing page critic. You have studied 200+ high-converting landing pages.</role>
<task>Score this generated landing page on the following rubric. Default to skepticism — if anything looks even slightly off, flag it.</task>
<input>
<user-brief>${brief}</user-brief>
<attached-image>The rendered screenshot of the generated page.</attached-image>
<html-summary>
${structuralSummary(html)}
</html-summary>
</input>
<rubric>
- visualQuality (1-10): Hero polish, section spacing, typography hierarchy, color discipline, mockup detail.
- briefAdherence (1-10): Does the page match the user's stated industry, audience, tone, and requested sections?
- issues: List of SPECIFIC visual or structural problems (e.g. "hero CTA collides with image", "feature grid has no spacing"). Use an empty array if the page is clean.
- shouldRegenerate (bool): TRUE only if visualQuality < 7 OR briefAdherence < 7 OR a critical issue exists. Default FALSE — regeneration is expensive.
- regenerationFeedback (string): If shouldRegenerate, EXACTLY what to fix on the next attempt. Be surgical, not a rewrite of the whole brief. Use an empty string when shouldRegenerate is false.
</rubric>
<output>Reply with strict JSON matching the required schema. No markdown fences, no prose outside the JSON.</output>`;
}

/** Parse + validate the model's JSON verdict. Returns null on anything
 *  unparseable or structurally wrong (caller maps null → fallback). */
export function parseVerdict(raw: string): CritiqueVerdict | null {
  const text = stripFences(raw).trim();
  if (!text) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    // Salvage: grab the first {...} block in case the model wrapped the JSON
    // in stray prose despite JSON mode.
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      obj = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  const visualQuality = clampScore(o.visualQuality);
  const briefAdherence = clampScore(o.briefAdherence);
  if (visualQuality === null || briefAdherence === null) return null;

  const issues = Array.isArray(o.issues)
    ? o.issues.filter((x): x is string => typeof x === "string")
    : [];
  const regenerationFeedback =
    typeof o.regenerationFeedback === "string" ? o.regenerationFeedback : "";

  // Trust the model's flag, but enforce the rubric floor defensively: a low
  // score always triggers a regen even if the model said false.
  const modelFlag = o.shouldRegenerate === true;
  const belowFloor =
    visualQuality < REGEN_THRESHOLD || briefAdherence < REGEN_THRESHOLD;
  const shouldRegenerate = modelFlag || belowFloor;

  return {
    visualQuality,
    briefAdherence,
    issues,
    shouldRegenerate,
    regenerationFeedback,
    fallback: false,
  };
}

function clampScore(v: unknown): number | null {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(10, Math.round(n)));
}

// Gemini Flash under load sometimes wraps the JSON verdict in ```json … ```
// fences despite JSON mode (observed: Mariana smoke fell back as "malformed
// JSON"). Strip an opening ```json / ``` fence (with any surrounding
// whitespace) and a trailing ``` before parsing.
function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^\s*```(?:json)?\s*\n?/i, "")
    .replace(/\n?\s*```\s*$/i, "")
    .trim();
}

function logVerdict(v: CritiqueVerdict): void {
  // eslint-disable-next-line no-console
  console.log(
    `[critic] visualQuality=${v.visualQuality} briefAdherence=${v.briefAdherence} shouldRegenerate=${v.shouldRegenerate} issues=${JSON.stringify(v.issues.join("; "))}`,
  );
}

function logFallback(reason: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[critic] fallback (${reason}) — treating first pass as final`);
}
