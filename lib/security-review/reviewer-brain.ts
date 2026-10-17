// lib/security-review/reviewer-brain.ts — the options of the reviewer's brain.
//
// Len's brain, with Len's providers: DeepInfra first, Fireworks as fallback.
// v1 pinned it to Fireworks (spec local
// docs/superpowers/specs/2026-10-16-second-provider-design.md §3.2: its HIGH
// findings stop a publish, and the quality gate measured Len's turns, not the
// reviewer); Jesús unpinned it on 2026-10-17 — OpenLen pays the review, and on
// DeepInfra it costs ~60 % less. Kept apart from real.ts, which pulls Postgres
// in, so a test can read it.

import type { AgentBrainOptions } from "@/lib/agent/brain";

/** How hard the reviewer thinks, in the agent's posture layer. */
const REVIEW_EFFORT = "high" as const;

export function reviewerBrainOptions(o: {
  readonly tools: Record<string, unknown>[];
  readonly projectId: string;
  readonly signal?: AbortSignal;
}): AgentBrainOptions {
  return {
    tools: o.tools,
    requestId: `security-review:${o.projectId}`,
    signal: o.signal,
    esfuerzoDelTurno: REVIEW_EFFORT,
  };
}
