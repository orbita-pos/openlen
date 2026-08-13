import { z } from "zod";

import type { FireworksJsonClient } from "@/lib/ai/fireworks-client";
import type { FireworksJsonResult } from "@/lib/ai/fireworks-contracts";
import { AdaptivePageDesignProgramSchema, type AdaptivePageDesignProgram } from "./adaptive-design-contracts";
import { AdaptiveSectionRepairHandoffSchema, type AdaptiveSectionRepairHandoff } from "./adaptive-section-composition";
import { ExpressiveSectionProgramSchema, validateExpressiveSectionProgram, type ExpressiveSectionProgram } from "./expressive-section-contracts";
import { reasoningEffortFor } from "./fable-model-policy";
import { BoundedVisualIssueSchema, type BoundedVisualIssue } from "@/lib/ai/qwen-visual-critic";

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,111}$/;
const PROGRAM_ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export const GlmVisualRepairDeltaSchema = z.object({
  schemaVersion: z.literal("glm-visual-repair-delta/1.0"),
  changes: z.array(z.object({
    programId: z.string().regex(PROGRAM_ID),
    program: ExpressiveSectionProgramSchema,
  }).strict()).min(1).max(32),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.changes.map((change) => change.programId)).size !== value.changes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["changes"], message: "program changes must be unique" });
  }
});

export type GlmVisualRepairDelta = z.infer<typeof GlmVisualRepairDeltaSchema>;

export interface GlmVisualRepairRequest {
  readonly requestId: string;
  readonly design: AdaptivePageDesignProgram;
  readonly programs: readonly {
    readonly programId: string;
    readonly role: ExpressiveSectionProgram["role"];
    readonly allowedCopyKeys: readonly string[];
    readonly allowedAssetSlots: readonly number[];
    readonly program: ExpressiveSectionProgram;
  }[];
  readonly issues: readonly BoundedVisualIssue[];
}

type GatewayFailure = Extract<FireworksJsonResult<never>, { ok: false }>;
export type GlmVisualRepairProviderResult = GatewayFailure | {
  readonly ok: true;
  readonly delta: GlmVisualRepairDelta;
  readonly modelId: string;
  readonly usage: Extract<FireworksJsonResult<unknown>, { ok: true }>['usage'];
  readonly durationMs: number;
  readonly attempts: 1 | 2;
} | { readonly ok: false; readonly code: "invalid_input" };

export interface GlmVisualRepairProvider {
  repair(request: GlmVisualRepairRequest): Promise<GlmVisualRepairProviderResult>;
}

function safeRequest(request: GlmVisualRepairRequest): boolean {
  if (!REQUEST_ID.test(request.requestId) || request.programs.length < 1 || request.programs.length > 32 || request.issues.length < 1 || request.issues.length > 8) return false;
  if (!AdaptivePageDesignProgramSchema.safeParse(request.design).success || request.issues.some((issue) => !BoundedVisualIssueSchema.safeParse(issue).success)) return false;
  const ids = new Set<string>();
  for (const entry of request.programs) {
    if (!PROGRAM_ID.test(entry.programId) || ids.has(entry.programId) || entry.program.role !== entry.role) return false;
    ids.add(entry.programId);
    const validated = validateExpressiveSectionProgram(entry.program, { allowedCopyKeys: entry.allowedCopyKeys, allowedAssetSlots: entry.allowedAssetSlots });
    if (!validated.ok) return false;
  }
  return true;
}

/** Factory for the one permitted GLM visual-repair call. */
export function createGlmVisualRepairProvider(options: { readonly client: FireworksJsonClient }): GlmVisualRepairProvider {
  if (!options?.client) throw new Error("Fireworks client with PageBudget is required");
  return {
    async repair(request) {
      if (!safeRequest(request)) return { ok: false, code: "invalid_input" };
      const result = await options.client.request({
        role: "designer",
        reasoningEffort: reasoningEffortFor("designer", "visual_repair"),
        requestId: `${request.requestId}.repair`,
        maxOutputTokens: 8192,
        responseSchema: GlmVisualRepairDeltaSchema,
        messages: [
          { role: "system", content: "Return only glm-visual-repair-delta/1.0. Change only supplied program IDs. A program is a bounded AST, never HTML, CSS, JavaScript, copy values, URLs, selectors, prompts, explanations, or executable text." },
          { role: "user", content: JSON.stringify({
            schemaVersion: "glm-visual-repair-input/1.0",
            design: request.design,
            issues: request.issues,
            programs: request.programs.map((program) => ({ programId: program.programId, role: program.role, allowedCopyKeys: program.allowedCopyKeys, allowedAssetSlots: program.allowedAssetSlots, program: program.program })),
          }) },
        ],
      });
      if (!result.ok) return result;
      return { ok: true, delta: result.value, modelId: result.modelId, usage: result.usage, durationMs: result.durationMs, attempts: result.attempts };
    },
  };
}

export type VisualRepairMachineResult =
  | { readonly ok: true; readonly state: "repaired"; readonly delta: GlmVisualRepairDelta; readonly telemetry: Extract<GlmVisualRepairProviderResult, { ok: true }> }
  | { readonly ok: false; readonly code: "invalid_input" | "repair_already_consumed" | "provider_failed" | "invalid_delta"; readonly telemetry?: Exclude<GlmVisualRepairProviderResult, { ok: true }> };

function programsFromHandoff(handoff: AdaptiveSectionRepairHandoff): GlmVisualRepairRequest["programs"] {
  return handoff.entries.flatMap((entry) => entry.programId && entry.program
    ? [{ programId: entry.programId, role: entry.role, allowedCopyKeys: entry.allowedCopyKeys, allowedAssetSlots: entry.allowedAssetSlots, program: entry.program as ExpressiveSectionProgram }]
    : []);
}

function validDelta(delta: GlmVisualRepairDelta, request: GlmVisualRepairRequest): boolean {
  const byId = new Map(request.programs.map((program) => [program.programId, program]));
  return delta.changes.every((change) => {
    const previous = byId.get(change.programId);
    if (!previous || previous.role !== change.program.role) return false;
    return validateExpressiveSectionProgram(change.program, {
      allowedCopyKeys: previous.allowedCopyKeys,
      allowedAssetSlots: previous.allowedAssetSlots,
    }).ok;
  });
}

/**
 * The private machine owns the single repair token. Consumers can only obtain
 * `repaired` once; there is intentionally no transition back to `ready`.
 */
export function createVisualRepairMachine(
  input: { readonly design: AdaptivePageDesignProgram; readonly handoff: AdaptiveSectionRepairHandoff; readonly issues: readonly BoundedVisualIssue[]; readonly requestId?: string },
  deps: { readonly provider: GlmVisualRepairProvider },
): { requestRepair(): Promise<VisualRepairMachineResult> } {
  const parsedHandoff = AdaptiveSectionRepairHandoffSchema.safeParse(input.handoff);
  const parsedDesign = AdaptivePageDesignProgramSchema.safeParse(input.design);
  const programs = parsedHandoff.success ? programsFromHandoff(parsedHandoff.data) : [];
  const request: GlmVisualRepairRequest | null = parsedDesign.success
    && parsedHandoff.success
    && programs.length > 0
    && input.issues.length > 0
    ? { requestId: input.requestId ?? "fable-visual-repair", design: parsedDesign.data, programs, issues: input.issues }
    : null;
  let state: "ready" | "consumed" | "invalid" = request && safeRequest(request) ? "ready" : "invalid";

  return {
    async requestRepair() {
      if (state !== "ready") return state === "invalid"
        ? { ok: false, code: "invalid_input" }
        : { ok: false, code: "repair_already_consumed" };
      state = "consumed";
      const result = await deps.provider.repair(request!);
      if (!result.ok) return { ok: false, code: "provider_failed", telemetry: result };
      const parsedDelta = GlmVisualRepairDeltaSchema.safeParse(result.delta);
      if (!parsedDelta.success || !validDelta(parsedDelta.data, request!)) {
        return { ok: false, code: "invalid_delta" };
      }
      return { ok: true, state: "repaired", delta: parsedDelta.data, telemetry: result };
    },
  };
}
