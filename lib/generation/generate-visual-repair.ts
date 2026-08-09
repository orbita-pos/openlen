import { GeminiProvider, type StreamEvent, type StreamRequest } from "@/lib/ai-gateway";
import {
  CreativeDirectionSchema,
  SkeletonAdaptationPlanSchema,
  SkeletonInventorySchema,
  type CreativeDirection,
  type SkeletonAdaptationPlan,
  type SkeletonInventory,
} from "./creative-contracts";
import { VisualQualityVerdictSchema, type VisualQualityVerdict } from "./visual-repair-contracts";
import type { VisualQualityUsage } from "@/lib/ai/visual-quality-critic";

export const VISUAL_REPAIR_PROMPT_VERSION = "visual-repair-prompt/1.0" as const;
const RESPONSE_VERSION = "visual-repair-response/1.0" as const;

export interface VisualRepairPlanRequest { direction: CreativeDirection; inventory: SkeletonInventory; verdict: VisualQualityVerdict }
export interface VisualRepairPlanProvider {
  generate(request: VisualRepairPlanRequest, options: { signal: AbortSignal }): Promise<{ text: string; usage?: VisualQualityUsage }>;
}
export type GenerateVisualRepairPlanResult =
  | { ok: true; plan: SkeletonAdaptationPlan; usage?: VisualQualityUsage; promptVersion: typeof VISUAL_REPAIR_PROMPT_VERSION; durationMs: number }
  | { ok: false; kind: "missing_api_key" | "timeout" | "provider_error" | "invalid_json" | "future_version" | "schema"; usage?: VisualQualityUsage; promptVersion: typeof VISUAL_REPAIR_PROMPT_VERSION; durationMs: number };
export interface GenerateVisualRepairPlanOptions {
  apiKey?: string; modelId?: string; provider?: VisualRepairPlanProvider;
  providerFactory?: (apiKey: string) => VisualRepairPlanProvider; timeoutMs?: number; now?: () => number;
}

function usageAdd(current: VisualQualityUsage | undefined, event: Extract<StreamEvent, { type: "usage" }>): VisualQualityUsage {
  return { inputTokens: (current?.inputTokens ?? 0) + event.inputTokens, outputTokens: (current?.outputTokens ?? 0) + event.outputTokens, cachedTokens: (current?.cachedTokens ?? 0) + event.cachedTokens, thinkingTokens: (current?.thinkingTokens ?? 0) + event.thinkingTokens };
}

class GatewayRepairProvider implements VisualRepairPlanProvider {
  constructor(private readonly provider: GeminiProvider, private readonly model: string) {}
  async generate(request: VisualRepairPlanRequest, options: { signal: AbortSignal }) {
    const streamRequest: StreamRequest = {
      model: this.model,
      messages: [{ role: "user", content: [
        "You are OpenLen's bounded visual repair planner. The existing creative direction is authoritative.",
        "Return one delta plan only. Preserve brand and explicit constraints. Never emit HTML, selectors, URLs, scripts, copy, structure, or free-form CSS.",
        JSON.stringify(request),
      ].join("\n") }],
      responseMimeType: "application/json", temperature: 0, maxOutputTokens: 2048,
    };
    let text = ""; let usage: VisualQualityUsage | undefined;
    for await (const event of this.provider.stream(streamRequest, { signal: options.signal })) {
      if (event.type === "text_delta") text += event.text;
      if (event.type === "usage") usage = usageAdd(usage, event);
      if (event.type === "done" && event.stopReason.kind === "error") throw Object.assign(new Error("provider"), { usage });
    }
    return { text, ...(usage ? { usage } : {}) };
  }
}

export async function generateVisualRepairPlan(input: VisualRepairPlanRequest, options: GenerateVisualRepairPlanOptions = {}): Promise<GenerateVisualRepairPlanResult> {
  const now = options.now ?? Date.now; const start = now();
  const base = { promptVersion: VISUAL_REPAIR_PROMPT_VERSION, durationMs: 0 };
  const direction = CreativeDirectionSchema.safeParse(input.direction);
  const inventory = SkeletonInventorySchema.safeParse(input.inventory);
  const verdict = VisualQualityVerdictSchema.safeParse(input.verdict);
  if (!direction.success || !inventory.success || !verdict.success) return { ok: false, kind: "schema", ...base };
  const request: VisualRepairPlanRequest = { direction: direction.data, inventory: inventory.data, verdict: verdict.data };
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!options.provider && !apiKey) return { ok: false, kind: "missing_api_key", ...base };
  let provider: VisualRepairPlanProvider;
  try { provider = options.provider ?? options.providerFactory?.(apiKey!) ?? new GatewayRepairProvider(new GeminiProvider(apiKey!), options.modelId ?? "gemini-2.5-flash"); }
  catch { return { ok: false, kind: "provider_error", ...base }; }
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  let usage: VisualQualityUsage | undefined;
  try {
    const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => { controller.abort(); resolve("timeout"); }, options.timeoutMs ?? 15_000); });
    const generated = await Promise.race([provider.generate(request, { signal: controller.signal }), timeout]);
    if (generated === "timeout") return { ok: false, kind: "timeout", ...base, durationMs: now() - start };
    usage = generated.usage;
    let parsed: unknown;
    try { parsed = JSON.parse(generated.text); } catch { return { ok: false, kind: "invalid_json", ...(usage ? { usage } : {}), ...base, durationMs: now() - start }; }
    if (typeof parsed === "object" && parsed !== null && "schemaVersion" in parsed && (parsed as { schemaVersion?: unknown }).schemaVersion !== RESPONSE_VERSION) {
      return { ok: false, kind: "future_version", ...(usage ? { usage } : {}), ...base, durationMs: now() - start };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).some((key) => !["schemaVersion", "plan"].includes(key)) || (parsed as { schemaVersion?: unknown }).schemaVersion !== RESPONSE_VERSION) {
      return { ok: false, kind: "schema", ...(usage ? { usage } : {}), ...base, durationMs: now() - start };
    }
    const plan = SkeletonAdaptationPlanSchema.safeParse((parsed as { plan?: unknown }).plan);
    if (!plan.success) return { ok: false, kind: "schema", ...(usage ? { usage } : {}), ...base, durationMs: now() - start };
    return { ok: true, plan: plan.data, ...(usage ? { usage } : {}), ...base, durationMs: now() - start };
  } catch (error) {
    const caughtUsage = (error as { usage?: VisualQualityUsage } | null)?.usage ?? usage;
    return { ok: false, kind: "provider_error", ...(caughtUsage ? { usage: caughtUsage } : {}), ...base, durationMs: now() - start };
  } finally { if (timer) clearTimeout(timer); controller.abort(); }
}
