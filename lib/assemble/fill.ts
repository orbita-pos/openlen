// Content-fill stage of the assembler: drop the recipe's INVENTED brief copy
// into the stitched+bound page via the ID-tagged leaf-ops protocol, on GEMINI
// FLASH (fill-gemini.ts — the F3 Gemini-only stack, NOT Kimi/Together). The
// recipe already produced full copy, so the fill prompt's sparse-data discipline
// never strips anything here.
//
// Two assembler-specific behaviours:
//  1. Graceful degrade — if the fill model errors / under-applies, return the
//     stitched page UNFILLED (generic-but-coherent copy) rather than failing the
//     whole assembly. A page with the section's authored copy still ships.
//  2. fill-gemini imports the native Rust html-ops binding, so it's loaded
//     LAZILY (dynamic import) — keeps this module unit-testable (the test injects
//     a fill fn and never touches the .node binding).
//
// v1 keeps the autofill 64-op cap (it prioritises by prominence: hero → features
// → pricing → CTAs → testimonials → FAQ → footer). Per-section scoped fill for
// very long pages is a documented fast-follow.

import type { ExtractedBusinessData } from "../style-match/autofill/types";
import type {
  FillTemplateInput,
  FillTemplateResult,
} from "../style-match/autofill/fill-template";

type FillFn = (input: FillTemplateInput) => Promise<FillTemplateResult>;

export interface FillAssembledResult {
  html: string;
  /** true if the model applied copy ops; false if skipped or degraded. */
  filled: boolean;
  appliedOps: number;
  /** present when fill was skipped or degraded (why). */
  reason?: string;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
}

/** Is there any copy worth a fill pass? An all-null recipe copy → skip (the
 *  stitched page already reads coherently with the sections' authored copy). */
export function hasFillableCopy(c: ExtractedBusinessData): boolean {
  return Boolean(
    c.business_name ||
      c.tagline_en ||
      c.tagline_es ||
      c.pitch ||
      c.cta_primary ||
      c.cta_secondary ||
      c.features?.length ||
      c.pricing?.length ||
      c.testimonials?.length ||
      c.faq_questions?.length ||
      c.contact?.whatsapp ||
      c.contact?.phone ||
      c.contact?.email ||
      c.contact?.address,
  );
}

export interface FillAssembledOpts {
  signal?: AbortSignal;
  onStage?: FillTemplateInput["onStage"];
  /** Inject the fill engine (default: the real fillTemplate, loaded lazily). */
  fillFn?: FillFn;
}

/** Fill the stitched+bound document with the recipe's invented copy. Never
 *  throws on a model failure — degrades to the unfilled page. */
export async function fillAssembled(
  stitchedHtml: string,
  copy: ExtractedBusinessData,
  opts?: FillAssembledOpts,
): Promise<FillAssembledResult> {
  if (!hasFillableCopy(copy)) {
    return { html: stitchedHtml, filled: false, appliedOps: 0, reason: "no copy to fill", durationMs: 0 };
  }
  const fill: FillFn = opts?.fillFn ?? (await import("./fill-gemini")).fillWithGemini;

  const r = await fill({
    sourceHtml: stitchedHtml,
    data: copy,
    signal: opts?.signal,
    onStage: opts?.onStage,
  });

  if (r.ok) {
    return {
      html: r.filledHtml,
      filled: true,
      appliedOps: r.appliedOps,
      usage: r.usage,
      durationMs: r.durationMs,
    };
  }
  // Degrade: keep the coherent stitched page; surface why for telemetry.
  return {
    html: stitchedHtml,
    filled: false,
    appliedOps: r.appliedOps ?? 0,
    reason: r.error.message,
    durationMs: r.durationMs,
  };
}
