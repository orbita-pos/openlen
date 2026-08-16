import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";
import type { SectionRecord } from "@/lib/sections/store";
import type { validateAiCompositionDelivery } from "./ai-composition-delivery";
import type { buildCreativeBaseline, SafeCreativeCandidate } from "./creative-baseline";
import type { AdvisoryReviewResult } from "./advisory-visual-review";
import type { CreativeSessionResult } from "./deepseek-creative-session";

export interface CreativeGenerationInput {
  readonly projectId: string;
  readonly brief: string;
  readonly profileData: BusinessProfileData;
  readonly records: readonly SectionRecord[];
  readonly onStage?: (stage: string) => void;
}

export interface CreativeGenerationDeps {
  readonly buildBaseline: typeof buildCreativeBaseline;
  /** Forwarded to the baseline builder so the whole path can run offline. */
  readonly fetchText?: (storageUrl: string) => Promise<string | null>;
  /** The baseline's own render gate. Without it the baseline builder falls back
   * to a stub that approves every document, so overflow ships unchecked. */
  readonly renderCandidate?: (html: string) => Promise<{ mobileOverflow: boolean; invalidGeometry: boolean } | null>;
  /** `intent` travels with both improvement stages: the image boundary and the
   * vision critic both speak the taxonomy, not the free-text brief. */
  readonly runCreativeSession: (input: {
    requestId: string;
    brief: string;
    baseline: SafeCreativeCandidate;
    intent: IntentAnalysis;
  }) => Promise<CreativeSessionResult>;
  readonly runAdvisoryReview: (input: {
    requestId: string;
    brief: string;
    candidate: SafeCreativeCandidate;
    intent: IntentAnalysis;
  }) => Promise<AdvisoryReviewResult>;
  readonly validateDelivery: typeof validateAiCompositionDelivery;
  /** Terminal: only the two branches that cost the user a page use it. */
  readonly recordFailure?: (stage: string, reasonCode: string) => void;
  /** Non-terminal: a stage that failed while the page still ships. */
  readonly recordDegraded?: (stage: string, reasonCode: string) => void;
}

export type CreativeGenerationResult =
  | {
      readonly ok: true;
      readonly route: "section_composition";
      readonly templateId: null;
      readonly title: string;
      readonly html: string;
      readonly visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
      readonly filled: boolean;
      readonly appliedOps: number;
      /** True when the delivered page is the baseline because an improvement
       * stage failed or was refused. Never a reason to abort. */
      readonly degraded: boolean;
    }
  | { readonly ok: false; readonly stage: "composition" | "delivery_gate"; readonly reasonCode: string };

function notify(input: CreativeGenerationInput, stage: string): void {
  try { input.onStage?.(stage); } catch {
    // Progress reporting cannot change delivery.
  }
}

/**
 * Baseline first, then improvement. Once a safe baseline exists the only ways
 * out are a delivered page or a delivery gate that refuses both the improved
 * candidate and the baseline. No provider can abort a page from here.
 */
export async function runCreativeGeneration(
  input: CreativeGenerationInput,
  deps: CreativeGenerationDeps,
): Promise<CreativeGenerationResult> {
  notify(input, "baseline");
  let baseline;
  try {
    baseline = await deps.buildBaseline({
      projectId: input.projectId,
      brief: input.brief,
      profileData: input.profileData,
      records: input.records,
    }, {
      ...(deps.fetchText ? { fetchText: deps.fetchText } : {}),
      ...(deps.renderCandidate ? { render: deps.renderCandidate } : {}),
      // The baseline ships even when the gate cannot give it every guarantee,
      // so the reason only exists if it is recorded here.
      onDegraded: (reason: string) => deps.recordDegraded?.("baseline", reason),
    });
  } catch {
    deps.recordFailure?.("baseline", "composition_failed");
    return { ok: false, stage: "composition", reasonCode: "composition_failed" };
  }
  if (!baseline.ok) {
    // The user-facing reason stays coarse; the journal gets the real cause, or
    // "the catalog broke" is indistinguishable from "the page did".
    deps.recordFailure?.("baseline", baseline.detail || baseline.code);
    return { ok: false, stage: "composition", reasonCode: baseline.code };
  }

  let lastKnownGood = baseline.candidate;
  let degraded = false;

  notify(input, "creative");
  try {
    const creative = await deps.runCreativeSession({
      requestId: input.projectId,
      brief: input.brief,
      baseline: lastKnownGood,
      intent: baseline.intent,
    });
    lastKnownGood = creative.candidate;
    if (!creative.changed) {
      degraded = true;
      deps.recordDegraded?.("creative_session", creative.stoppedBy);
    }
    // Reported whether or not the page changed: a session that redesigned the
    // page and had every image request refused looks identical to one that
    // never asked, and only this says which.
    for (const code of creative.rejections) deps.recordDegraded?.("creative_session", `tool_${code}`);
  } catch {
    degraded = true;
    deps.recordDegraded?.("creative_session", "internal_error");
  }

  notify(input, "review");
  try {
    const reviewed = await deps.runAdvisoryReview({
      requestId: input.projectId,
      brief: input.brief,
      candidate: lastKnownGood,
      intent: baseline.intent,
    });
    lastKnownGood = reviewed.candidate;
    if (!reviewed.reviewed) deps.recordDegraded?.("advisory_review", "review_unavailable");
  } catch {
    deps.recordDegraded?.("advisory_review", "internal_error");
  }

  notify(input, "delivery_gate");
  const deliver = (candidate: SafeCreativeCandidate) => {
    try {
      return deps.validateDelivery({ html: candidate.html, visualEngine: candidate.visualEngine, leaksAfter: 0 });
    } catch {
      return { ok: false as const, reasonCode: "invalid_composition_metadata" as const };
    }
  };

  let chosen = lastKnownGood;
  let validated = deliver(chosen);
  if (!validated.ok && chosen !== baseline.candidate) {
    // An improvement that cannot ship must not cost the page the baseline
    // already earned.
    deps.recordDegraded?.("delivery_gate", validated.reasonCode);
    chosen = baseline.candidate;
    degraded = true;
    validated = deliver(chosen);
  }
  if (!validated.ok) {
    deps.recordFailure?.("delivery_gate", validated.reasonCode);
    return { ok: false, stage: "delivery_gate", reasonCode: validated.reasonCode };
  }

  return {
    ok: true,
    route: "section_composition",
    templateId: null,
    title: chosen.title,
    html: chosen.html,
    visualEngine: validated.visualEngine as Extract<VisualEngineProjectMetadata, { route: "section_composition" }>,
    filled: chosen.filled,
    appliedOps: chosen.appliedOps,
    degraded,
  };
}
