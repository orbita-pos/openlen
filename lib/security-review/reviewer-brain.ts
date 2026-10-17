// lib/security-review/reviewer-brain.ts — the options of the reviewer's brain.
//
// Len's brain, pinned to Fireworks in v1 (spec local
// docs/superpowers/specs/2026-10-16-second-provider-design.md §3.2): its HIGH
// findings stop a publish (428), and the quality gate of that spec measures
// Len's turns, not the reviewer. Kept apart from real.ts, which pulls Postgres
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
    providers: ["fireworks"],
  };
}
