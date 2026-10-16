// lib/security-review/real.ts — the reviewer with its real parts:
//   · Postgres;
//   · the project as stored;
//   · the model, as read-only subagents on Len's brain (the `security_review`
//     operation of lib/generation/model-policy.ts), with Len's own Read, Grep
//     and Glob over the project's files.
// One per process: the reviews in flight live in it.

import "server-only";

import { createAgentBrain } from "@/lib/agent/brain";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
import { streamWithRetry } from "@/lib/agent/retry";
import { correrSubagente, declaracionesDeSoloLectura } from "@/lib/agent/subagente";
import { realDeps, runAgentTool, type AgentSession } from "@/lib/agent/tools";
import { creditsForUsage } from "@/lib/credits";
import { creditRateForRole, roleForOperation } from "@/lib/generation/model-policy";

import { loadReviewInputs } from "./inputs";
import { reviewWithModel, type Run } from "./model-review";
import { createSecurityReviewer, type ReviewDeps, type SecurityReviewer } from "./review";
import { pgSecurityReviewStore } from "./store-pg";

/** How hard the reviewer thinks, in the agent's posture layer. */
const REVIEW_EFFORT = "high" as const;

const modelReview: ReviewDeps["modelReview"] = async ({ inputs, context, focus, signal }) => {
  const declarations = declaracionesDeSoloLectura(buildFunctionDeclarations(process.env, {}, "len", inputs.app));
  const deps = realDeps();
  const run: Run = (o) => {
    const brain = createAgentBrain({ tools: declarations, requestId: `security-review:${inputs.projectId}`, signal: o.signal, esfuerzoDelTurno: REVIEW_EFFORT });
    // Each subagent starts with nothing read and remembers only what it reads.
    const session: AgentSession = {
      projectId: inputs.projectId,
      userId: inputs.ownerId,
      app: inputs.app,
      page: null,
      ownerEmail: null,
      imageEditsThisTurn: 0,
      photoSearchesThisTurn: 0,
      busquedasVaciasSeguidas: 0,
      leidos: new Map(),
    };
    return correrSubagente({
      sistema: o.system,
      mensajes: o.messages,
      declaraciones: declarations,
      maxVueltas: o.maxTurns,
      openStream: (m) => streamWithRetry(() => brain.openStream(m), { signal: o.signal }),
      closeOut: (m) => streamWithRetry(() => brain.closeOut(m), { signal: o.signal }),
      leer: (name, args) => runAgentTool(session, deps, name, args),
    });
  };
  const r = await reviewWithModel(run, { context, focus, signal });
  const used = r.usage.inputTokens + r.usage.outputTokens > 0;
  const rate = creditRateForRole(roleForOperation("security_review"));
  return { ...r, costCentiCredits: used ? creditsForUsage(r.usage.inputTokens, r.usage.outputTokens, rate, r.usage.cachedTokens) : 0 };
};

let reviewer: SecurityReviewer | null = null;

export function securityReviewer(): SecurityReviewer {
  reviewer ??= createSecurityReviewer({ store: pgSecurityReviewStore, loadInputs: loadReviewInputs, modelReview, now: () => new Date(), env: process.env });
  return reviewer;
}
