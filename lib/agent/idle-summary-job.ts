// THE IDLE SUMMARY'S JOB, built OUTSIDE the route (spec local 2026-11-13-conversar-todo-el-mes, piece B).
//
// A job waits almost an hour in a timer (./idle-summary.ts). A function written inside the request handler
// keeps alive everything that handler's functions close over — the turn's stream, its brain, its result, the
// session —, because they all share one scope. Built here, from plain values, a waiting job holds exactly
// what it needs: the messages to summarize, the turn's tools (they are part of what the provider has
// cached) and a few ids.
import type { Message } from "@/lib/ai-gateway";
import { createAgentBrain, type AgentBrain, type AgentBrainOptions } from "@/lib/agent/brain";
import { IDLE_SUMMARY_OUTPUT_ESTIMATE, collectSummary, type IdleSummaryJob } from "@/lib/agent/idle-summary";
import { withPlanSection } from "@/lib/agent/plan-mode";
import { compactionMarkForStorage } from "@/lib/agent/transcripcion";
import type { ProviderId } from "@/lib/ai/providers";
import type { CreditRate } from "@/lib/ai/tarifas";
import { chargeCredits, creditsForUsage, getCreditState } from "@/lib/credits";
import type { LedgerUse } from "@/lib/credit-ledger";
import { isLastModelTurn, savePendingIdleSummary } from "@/lib/projects/chat";
import { sumarGasto } from "@/lib/projects/miembros";

export interface IdleSummaryJobInput {
  /** `${projectId}:${conversation ?? ""}`. */
  readonly key: string;
  /** What the turn was given plus its own transcript. */
  readonly messages: readonly Message[];
  readonly transcriptLength: number;
  readonly minTokens: number;
  /** The project whose chat holds the turn's row, and the conversation in it (`null` = Len's). */
  readonly projectId: string;
  readonly conversation: string | null;
  readonly rowId: string;
  /** Who pays: the project's owner. */
  readonly ownerId: string;
  /** Who spoke, when it was a member of the project and not its owner. */
  readonly memberId: string | null;
  readonly rate: CreditRate;
  /** Whether the turn ended in plan mode: its section is part of the request the provider has cached. */
  readonly planActive: boolean;
  /** Who answered the turn, and with which model: the summary is asked there first. */
  readonly provider: ProviderId;
  readonly model: string;
  /** How the turn asked. Anything that differs and the provider reads nothing from its cache. */
  readonly brain: Pick<AgentBrainOptions, "tools" | "requestId" | "esfuerzoDelTurno" | "esfuerzoDelUsuario" | "mode">;
}

export function idleSummaryJobFor(input: IdleSummaryJobInput): IdleSummaryJob {
  const { projectId, conversation, rowId, ownerId, memberId, rate } = input;
  // The turn's own brain may be aborted by the time the timer fires: the summary is asked with one of its
  // own, built the same way.
  let asked: AgentBrain | null = null;
  return {
    key: input.key,
    messages: input.messages,
    // After the system prompt and the manual, as in the turn.
    firstIndex: 2,
    transcriptLength: input.transcriptLength,
    minTokens: input.minTokens,
    // Claude Code looks again when its timer fires (`prefix_changed`, `newer_request`): the conversation may
    // have been archived or deleted, or have a turn this process did not cancel for (Len Watch writes its row
    // in the parent's chat).
    stillCurrent: () => isLastModelTurn(projectId, conversation, rowId),
    canAfford: async (tokens) => (await getCreditState(ownerId)).balance >= creditsForUsage(tokens, IDLE_SUMMARY_OUTPUT_ESTIMATE, rate, tokens),
    summarize: (request, signal) => {
      asked = createAgentBrain({ ...input.brain, signal, preferredProvider: input.provider });
      return collectSummary(asked.openStream(withPlanSection(request, input.planActive)));
    },
    // Nobody asked for this call: the owner pays it at the WARM price whatever the provider read from its
    // cache (DeepInfra does not say how long it keeps one). What it really was stays in the ledger row — its
    // list price and its cost —, and the production photo counts the misses.
    charge: async (u) => {
      const centicredits = creditsForUsage(u.inputTokens, u.outputTokens, rate, u.inputTokens);
      // Who answered and with which model, as the turn's own row says it: one use per provider that ran —
      // two when the fallback answered, each with its own model.
      const ran = asked?.providersUsed() ?? [];
      const at = new Date();
      const uses: LedgerUse[] =
        ran.length > 1
          ? ran.map((r) => ({ provider: r.provider, model: r.model, inputTokens: r.inputTokens, cachedTokens: r.cachedTokens, outputTokens: r.outputTokens, reasoningTokens: r.thinkingTokens, at }))
          : [{ provider: ran[0]?.provider ?? asked?.lastProvider() ?? input.provider, model: ran[0]?.model ?? asked?.modelId ?? input.model, inputTokens: u.inputTokens, cachedTokens: u.cachedTokens, outputTokens: u.outputTokens, at }];
      await chargeCredits(ownerId, centicredits, {
        surface: "idle_summary",
        outcome: "ok",
        projectId,
        // After a member's turn the row names the member and counts toward the members' monthly cap, like
        // the turn it follows.
        actorId: memberId,
        refId: rowId,
        listCenticredits: creditsForUsage(u.inputTokens, u.outputTokens, rate, u.cachedTokens),
        uses,
      });
      if (memberId) await sumarGasto(projectId, memberId, centicredits);
    },
    // As the mark of a turn that summarized itself: without the personal memory of who spoke and without
    // pixels.
    save: (pending) => savePendingIdleSummary(projectId, rowId, { ...pending, mark: compactionMarkForStorage(pending.mark) }),
  };
}
