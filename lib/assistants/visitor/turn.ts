// A VISITOR'S TURN WITH THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio, §4.2, §4.7, §5): Len's loop
// on Len's brain with the `assistant-visitor` definition, started by a message in the published page's bubble — no
// `/api/agent`, like the event tasks' judge (lib/event-tasks/judge.ts). A closed list (`offer_handoff`), low effort and
// four calls, then `closeOut`. Its system prompt is the same for every visitor of the business (one cached prefix);
// what the visit kept and the visitor's words go after it. Paid by the owner within the month's cap; with no room or no
// credits it sleeps before calling the model.
import "server-only";

import { randomUUID } from "node:crypto";

import type { Message, StreamEvent } from "@/lib/ai-gateway";
import type { BrainCall, ProviderUse } from "@/lib/agent/brain";
import { runAgentLoop, type AgentLoopResult } from "@/lib/agent/loop";
import type { ToolOutcomeSummary } from "@/lib/agent/telemetry/step-signals";

import type { AssistantTone } from "../names";
import { sleepReason, VISITOR_TURN_RESERVE, visitorCap, visitorMonth, visitorReservations, type Sleep } from "./budget";
import { OFFER_HANDOFF, replyText, VISITOR_TOOLS, visitorMessage, visitorSystemPrompt } from "./definition";
import type * as VisitorStore from "./store";

/** Calls with tools before it must answer (the definition's `maxTurns`). */
export const VISITOR_MAX_STEPS = 4;
/** A visitor doesn't wait a minute (spec §5). */
export const VISITOR_TURN_TIMEOUT_MS = 45_000;
/** What a visit keeps of what the model saw. */
export const VISIT_KEEP_MESSAGES = 24;

const NOT_GIVEN = "That tool isn't available with a visitor.";

export interface VisitorTurnInput {
  readonly projectId: string;
  readonly ownerId: string;
  readonly assistant: { readonly id: string; readonly name: string; readonly slug: string; readonly tone: AssistantTone; readonly memory: string };
  readonly businessName: string;
  /** What was published (`assistantProjects.knowledge`). */
  readonly knowledge: string;
  readonly siteLocale: string;
  readonly visitorId: string;
  /** Already cleaned (`sanitizeUserMessage`). */
  readonly message: string;
  /** The page's chat can take the visitor (the bubble's «talk to a person»). */
  readonly handoffAvailable: boolean;
  readonly signal?: AbortSignal;
}

export type VisitorTurnResult =
  | { readonly kind: "reply"; readonly text: string; readonly intent: "answer" | "handoff" | "lead" }
  | { readonly kind: "asleep"; readonly reason: Sleep }
  | { readonly kind: "busy" };

/** One provider's spend in a visitor's turn, as the ledger takes it. */
export interface VisitorUse {
  readonly provider: ProviderUse["provider"];
  readonly model: string;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
}

export interface VisitorTurnDeps {
  now(): Date;
  creditState(ownerId: string): Promise<{ readonly balance: number; readonly allotment: number }>;
  store: Pick<typeof VisitorStore, "visitOf" | "saveVisit" | "monthSpent" | "addMonthSpend" | "claimAsleepAlert" | "explicitVisitorCap">;
  /** `signal` stops the call in flight: the loop doesn't race its stream against one, only the brain does. */
  brain(
    tools: Record<string, unknown>[],
    onCall?: (call: BrainCall) => void,
    signal?: AbortSignal,
  ): {
    openStream(m: Message[]): AsyncIterable<StreamEvent>;
    closeOut(m: Message[]): AsyncIterable<StreamEvent>;
    providersUsed(): readonly ProviderUse[];
  };
  /** Charges the owner; returns what the turn cost, in centicredits. */
  charge(c: { ownerId: string; projectId: string; refId: string; usage: AgentLoopResult["usage"]; uses: readonly VisitorUse[] }): Promise<number>;
  notifyAsleep(o: { ownerId: string; projectId: string; assistantName: string; assistantSlug: string; reason: Sleep; month: string; spent: number; cap: number }): Promise<void>;
  /** Layer 0 (lib/agent/telemetry/): one recorder per turn. */
  recorder?(projectId: string, turnId: string, hasHistory: boolean): { onCall(c: BrainCall): void; onStepTools(b: readonly ToolOutcomeSummary[]): void; finish(end: { endReason: string }): void };
  runLoop?: typeof runAgentLoop;
  /** For the tests: the turn's limit. `VISITOR_TURN_TIMEOUT_MS` by default. */
  timeoutMs?: number;
}

/** The visits in flight in this process: one turn at a time per visitor. */
const running = new Set<string>();

/** The kept conversation: its last messages, starting at a visitor's message so no tool result is left without its call. */
function kept(transcript: readonly Message[]): Message[] {
  if (transcript.length <= VISIT_KEEP_MESSAGES) return [...transcript];
  for (let i = transcript.length - VISIT_KEEP_MESSAGES; i < transcript.length; i++) {
    const m = transcript[i]!;
    if (m.role === "user" && !m.functionResponses?.length) return transcript.slice(i);
  }
  return [];
}

export async function runVisitorTurn(input: VisitorTurnInput, deps?: VisitorTurnDeps): Promise<VisitorTurnResult> {
  const key = `${input.assistant.id}:${input.projectId}:${input.visitorId}`;
  if (running.has(key)) return { kind: "busy" };
  running.add(key);
  let release: (() => void) | null = null;
  try {
    const d = deps ?? (await defaultVisitorDeps());
    const now = d.now();
    const month = visitorMonth(now);
    const [credit, spent, explicit] = await Promise.all([d.creditState(input.ownerId), d.store.monthSpent(input.ownerId, month), d.store.explicitVisitorCap(input.ownerId)]);
    const cap = visitorCap(explicit, credit.allotment);
    const sleep = sleepReason({ balance: credit.balance, spent, inFlight: visitorReservations.reserved(input.ownerId), cap });
    release = sleep ? null : visitorReservations.tryReserve(input.ownerId, spent, VISITOR_TURN_RESERVE, cap);
    if (sleep || !release) {
      const reason: Sleep = sleep ?? "cap";
      if (await d.store.claimAsleepAlert(input.ownerId, month, reason)) {
        await d.notifyAsleep({ ownerId: input.ownerId, projectId: input.projectId, assistantName: input.assistant.name, assistantSlug: input.assistant.slug, reason, month, spent, cap }).catch((err: unknown) =>
          console.warn("[assistant-visitor] the owner couldn't be told she fell asleep", err),
        );
      }
      return { kind: "asleep", reason };
    }

    const visit = await d.store.visitOf(input.assistant.id, input.projectId, input.visitorId);
    const prior = kept((visit?.transcript ?? []) as Message[]);
    const ask: Message = { role: "user", content: visitorMessage(input.message) };
    const system: Message = {
      role: "system",
      content: visitorSystemPrompt({
        name: input.assistant.name,
        tone: input.assistant.tone,
        businessName: input.businessName,
        knowledge: input.knowledge,
        memory: input.assistant.memory,
        siteLocale: input.siteLocale,
      }),
    };
    // The turn's limit and the visitor leaving stop the provider call itself (through the brain), not only the loop.
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(new Error("the visitor's turn took too long")), d.timeoutMs ?? VISITOR_TURN_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
    const onLeave = () => stop.abort(input.signal?.reason);
    if (input.signal?.aborted) onLeave();
    else input.signal?.addEventListener("abort", onLeave, { once: true });
    const signal = stop.signal;
    const recorder = d.recorder?.(input.projectId, randomUUID(), prior.length > 0);
    const brain = d.brain([...VISITOR_TOOLS], recorder ? (c) => recorder.onCall(c) : undefined, signal);
    let handedOff = false;
    let steps = 0;
    const result = await (d.runLoop ?? runAgentLoop)({
      messages: [system, ...prior, ask],
      tools: [...VISITOR_TOOLS],
      openStream: (messages) => (++steps <= VISITOR_MAX_STEPS ? brain.openStream(messages) : brain.closeOut(messages)),
      closeOut: brain.closeOut,
      runTool: async (name) => {
        // The loop refuses what wasn't declared; this is the second gate of a list that must not grow by accident.
        if (name !== OFFER_HANDOFF) return { response: { ok: false, error: NOT_GIVEN } };
        handedOff = true;
        return {
          response: {
            ok: true,
            tool_result: input.handoffAvailable ? "The visitor now sees a button to talk to a person here." : "The visitor now sees a form to leave their name and email.",
          },
        };
      },
      emit: () => {},
      unattended: true,
      signal,
      ...(recorder ? { onStepTools: (b: readonly ToolOutcomeSummary[]) => recorder.onStepTools(b) } : {}),
    }).finally(() => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onLeave);
    });
    recorder?.finish({ endReason: "done" });
    const text = replyText(result.finalText);
    const uses = brain.providersUsed().map((u) => ({ provider: u.provider, model: u.model, inputTokens: u.inputTokens, cachedTokens: u.cachedTokens, outputTokens: u.outputTokens, reasoningTokens: u.thinkingTokens }));
    const centicredits = await d.charge({ ownerId: input.ownerId, projectId: input.projectId, refId: key, usage: result.usage, uses });
    await d.store.addMonthSpend(input.ownerId, month, centicredits).catch((err: unknown) => console.warn("[assistant-visitor] the month's spend wasn't added", err));
    const at = now.toISOString();
    try {
      await d.store.saveVisit({
        assistantId: input.assistant.id,
        projectId: input.projectId,
        visitorId: input.visitorId,
        transcript: kept([...prior, ask, ...(result.transcripcion ?? [])]),
        newLines: [
          { role: "visitor", text: input.message, at },
          ...(text ? [{ role: "assistant" as const, text, at }] : []),
        ],
        centicredits,
        handedOff,
        at: now,
      });
    } catch (err) {
      // Deleted while it answered (its visits went with it): the visitor still gets the reply.
      console.warn("[assistant-visitor] the visit wasn't saved", err);
    }
    return { kind: "reply", text, intent: handedOff ? (input.handoffAvailable ? "handoff" : "lead") : "answer" };
  } finally {
    release?.();
    running.delete(key);
  }
}

/** The real parts, wired like the judge's (lib/event-tasks/judge.ts). */
async function defaultVisitorDeps(): Promise<VisitorTurnDeps> {
  const [{ createAgentBrain }, { streamWithRetry }, { creditsForUsage, chargeCredits, getCreditState }, policy, store, { createStepRecorder }, { createStepStore }, { drizzleStepStoreDb }, { ASSISTANT_VISITOR_AGENT_TYPE }] = await Promise.all([
    import("@/lib/agent/brain"),
    import("@/lib/agent/retry"),
    import("@/lib/credits"),
    import("@/lib/generation/model-policy"),
    import("./store"),
    import("@/lib/agent/telemetry/step-recorder"),
    import("@/lib/agent/telemetry/step-store"),
    import("@/lib/agent/telemetry/step-store-db"),
    import("@/lib/agent/subagents/bundled-types"),
  ]);
  const stepStore = createStepStore(drizzleStepStoreDb, { log: console.warn });
  return {
    now: () => new Date(),
    creditState: async (ownerId) => {
      const s = await getCreditState(ownerId);
      return { balance: s.balance, allotment: s.allotment };
    },
    store,
    brain: (tools, onCall, signal) => {
      const brain = createAgentBrain({
        tools,
        requestId: "assistant-visitor",
        esfuerzoDelTurno: ASSISTANT_VISITOR_AGENT_TYPE.effort ?? "low",
        ...(onCall ? { onCall } : {}),
        ...(signal ? { signal } : {}),
      });
      return {
        openStream: (m) => streamWithRetry(() => brain.openStream(m), signal ? { signal } : {}),
        closeOut: (m) => streamWithRetry(() => brain.closeOut(m), signal ? { signal } : {}),
        providersUsed: () => brain.providersUsed(),
      };
    },
    charge: async (c) => {
      const rate = policy.creditRateForRole(policy.roleForOperation("assistant_visitor"));
      const centicredits = creditsForUsage(c.usage.inputTokens, c.usage.outputTokens, rate, c.usage.cachedTokens);
      const at = new Date();
      await chargeCredits(c.ownerId, centicredits, {
        surface: "assistant_visitor",
        outcome: "ok",
        projectId: c.projectId,
        refId: c.refId,
        listCenticredits: centicredits,
        uses: c.uses.map((u) => ({ ...u, at })),
      });
      return centicredits;
    },
    // The owner hears it once per month and reason (the store's claim decides; the key makes a retry harmless).
    notifyAsleep: async (n) => {
      const { scheduleNotification } = await import("@/lib/notifications/dispatch");
      await scheduleNotification(
        { type: "assistant_asleep", projectId: n.projectId, recipientUserId: n.ownerId, assistantName: n.assistantName, assistantSlug: n.assistantSlug, reason: n.reason, spent: n.spent, cap: n.cap },
        `assistant-asleep:${n.ownerId}:${n.month}:${n.reason}`,
      );
    },
    recorder: (projectId, turnId, hasHistory) => createStepRecorder({ projectId, turnId, hasHistory, store: stepStore, log: console.warn }),
  };
}
