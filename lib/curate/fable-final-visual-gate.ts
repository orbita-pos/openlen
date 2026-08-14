import type { AdaptivePageDesignProgram } from "@/lib/generation/adaptive-design-contracts";
import type { AdaptiveSectionRepairHandoff } from "@/lib/generation/adaptive-section-composition";
import { isFinalVisualAcceptance, type BoundedVisualIssue, type FinalVisualVerdict } from "@/lib/ai/qwen-visual-critic";
import type { GlmVisualRepairDelta, GlmVisualRepairProvider } from "@/lib/generation/glm-visual-repair";
import { createVisualRepairMachine } from "@/lib/generation/glm-visual-repair";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";

type CompositionMetadata = Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;

/** Internal only; this artifact is deliberately absent from project metadata. */
export interface FableVisualRepairHandoff {
  readonly design: AdaptivePageDesignProgram;
  readonly sections: AdaptiveSectionRepairHandoff;
  /**
   * Ephemeral compiler closure owned by the adaptive composer. It never enters
   * project metadata: it recompiles only changed program IDs, then assembles
   * and renders the candidate for the terminal Qwen pass.
   */
  readonly applyDelta?: (delta: GlmVisualRepairDelta) => Promise<{ readonly ok: boolean; readonly candidate?: FableCandidate }>;
}

export type FableCandidate = { readonly html: string; readonly visualEngine: CompositionMetadata };
export type FableInspection = {
  readonly ok: boolean;
  readonly deterministic: { readonly mobileOverflow: boolean; readonly weakTypographyHierarchy: boolean; readonly invalidGeometry: boolean };
  readonly screenshots: { readonly desktop: { readonly mimeType: string; readonly dataBase64: string }; readonly mobile: { readonly mimeType: string; readonly dataBase64: string } };
};

export interface FableFinalVisualGateDeps {
  inspect(candidate: FableCandidate): Promise<FableInspection>;
  critique(input: { readonly requestId: string; readonly screenshots: FableInspection["screenshots"]; readonly deterministic: FableInspection["deterministic"] }): Promise<{ readonly ok: boolean; readonly verdict?: FinalVisualVerdict; readonly issues?: readonly BoundedVisualIssue[] }>;
  readonly repairProvider: GlmVisualRepairProvider;
  /** Applies program-id deltas, recompiles changed fragments, assembles and seals a new candidate. */
  applyDelta(delta: GlmVisualRepairDelta): Promise<{ readonly ok: boolean; readonly candidate?: FableCandidate }>;
}

export type FableFinalVisualGateResult =
  | { readonly ok: true; readonly candidate: FableCandidate; readonly repaired: boolean }
  | { readonly ok: false; readonly code: "deterministic_gate_failed" | "qwen_failed" | "visual_rejected" | "repair_failed" };

/** Finite final gate: no branch can invoke a second GLM repair. */
export async function runFableFinalVisualGate(
  input: { readonly requestId: string; readonly candidate: FableCandidate; readonly handoff: FableVisualRepairHandoff },
  deps: FableFinalVisualGateDeps,
): Promise<FableFinalVisualGateResult> {
  const judge = async (candidate: FableCandidate, round: "initial" | "final") => {
    const inspected = await deps.inspect(candidate);
    if (!inspected.ok) return { ok: false as const, code: "deterministic_gate_failed" as const };
    if (inspected.deterministic.mobileOverflow || inspected.deterministic.weakTypographyHierarchy || inspected.deterministic.invalidGeometry) {
      return { ok: false as const, code: "deterministic_gate_failed" as const };
    }
    const reviewed = await deps.critique({ requestId: `${input.requestId}.${round}`, screenshots: inspected.screenshots, deterministic: inspected.deterministic });
    if (!reviewed.ok || !reviewed.verdict) return { ok: false as const, code: "qwen_failed" as const };
    return { ok: true as const, verdict: reviewed.verdict, issues: reviewed.issues ?? reviewed.verdict.issues };
  };

  const initial = await judge(input.candidate, "initial");
  if (!initial.ok) return initial;
  if (initial.verdict.decision === "accept") return isFinalVisualAcceptance(initial.verdict)
    ? { ok: true, candidate: input.candidate, repaired: false }
    : { ok: false, code: "visual_rejected" };
  if (initial.verdict.decision === "reject") return { ok: false, code: "visual_rejected" };

  const machine = createVisualRepairMachine({ design: input.handoff.design, handoff: input.handoff.sections, issues: initial.issues, requestId: input.requestId }, { provider: deps.repairProvider });
  const repair = await machine.requestRepair();
  if (!repair.ok) return { ok: false, code: "repair_failed" };
  const applied = await deps.applyDelta(repair.delta);
  if (!applied.ok || !applied.candidate) return { ok: false, code: "repair_failed" };

  const final = await judge(applied.candidate, "final");
  if (!final.ok) return final;
  return isFinalVisualAcceptance(final.verdict)
    ? { ok: true, candidate: applied.candidate, repaired: true }
    : { ok: false, code: "visual_rejected" };
}
