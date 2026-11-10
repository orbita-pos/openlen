// THE TURN THAT JOINS WHAT VISITORS ASKED FOR (spec local 2026-11-06-asistente-propio, §4.3.2, §4.3.3, §4.7): Len's loop
// on Len's brain with ONE tool, `group_requests`, outside any visitor's turn — like the event tasks' judge
// (lib/event-tasks/judge.ts). It reads one assistant's waiting requests in one project and the cards still open there,
// and its answer is checked (./grouping.ts) and saved in one transaction (./store.ts). So what a visitor wrote never
// enters another visitor's turn, and nothing here can start Len: only the owner's press does (./press.ts).
//
// Paid by the owner inside the visitors' monthly cap (it is the visitors' doing); asleep — no credits or no room — it
// calls no model and the requests wait. The owner hears it once per pass: a new card, or a waiting one that reaches
// five people; a card set aside («Ahora no») grows in silence.
import "server-only";

import { randomUUID } from "node:crypto";

import type { Message, StreamEvent } from "@/lib/ai-gateway";
import type { BrainCall, ProviderUse } from "@/lib/agent/brain";
import { runAgentLoop, type AgentLoopResult } from "@/lib/agent/loop";
import type { ToolOutcomeSummary } from "@/lib/agent/telemetry/step-signals";
import type { ToolOutcome } from "@/lib/agent/tools";
import { pushText } from "@/lib/event-tasks/cards";
import type { LenAvisoEvent } from "@/lib/notifications/types";

import { sleepReason, VISITOR_TURN_RESERVE, visitorCap, visitorMonth, visitorReservations } from "../visitor/budget";
import type { VisitorUse } from "../visitor/turn";
import { applyGrouping, GROUP_REQUESTS, GROUP_REQUESTS_DECLARATION, groupingMessages } from "./grouping";
import { GROUP_BATCH, GROUP_MAX_STEPS, NOTICES_PER_PAIR_DAY, NOTIFY_AGAIN_AT } from "./limits";
import type * as RequestStore from "./store";
import type { RequestCardRow } from "./store";
import { requestEmail } from "./texts";

const NOT_GIVEN = "Only group_requests is available here.";

export interface GrouperDeps {
  now(): Date;
  /** The assistant and her person (who pays and who is told). */
  assistantOf(id: string): Promise<{ readonly id: string; readonly name: string; readonly personId: string } | null>;
  creditState(ownerId: string): Promise<{ readonly balance: number; readonly allotment: number }>;
  monthSpent(userId: string, month: string): Promise<number>;
  addMonthSpend(userId: string, month: string, centicredits: number, messages?: number): Promise<void>;
  explicitVisitorCap(userId: string): Promise<number | null>;
  brain(
    tools: Record<string, unknown>[],
    onCall?: (call: BrainCall) => void,
  ): {
    openStream(m: Message[]): AsyncIterable<StreamEvent>;
    closeOut(m: Message[]): AsyncIterable<StreamEvent>;
    providersUsed(): readonly ProviderUse[];
  };
  /** Charges the owner; returns what the turn cost, in centicredits. */
  charge(c: { ownerId: string; projectId: string; refId: string; usage: AgentLoopResult["usage"]; uses: readonly VisitorUse[] }): Promise<number>;
  notify(event: LenAvisoEvent, dedupeKey: string): Promise<void>;
  store: Pick<typeof RequestStore, "pendingRequests" | "joinableCards" | "saveGrouping" | "noticesSince" | "markNotified">;
  siteUrl: string;
  /** Layer 0 (lib/agent/telemetry/): its rows tagged `assistant-requests:<id>`, out of Len's baseline. */
  recorder?(o: { projectId: string; turnId: string; tag: string }): { onCall(c: BrainCall): void; onStepTools(b: readonly ToolOutcomeSummary[]): void; finish(end: { endReason: string }): void };
  runLoop?: typeof runAgentLoop;
}

/** The card the owner hears about in this pass, if any: a new one, or a waiting one that just reached five people.
 *  One per pass: of those, the one more people asked for. */
function worthTelling(saved: readonly { card: RequestCardRow; isNew: boolean; before: number }[]): RequestCardRow | null {
  const told = saved.filter(
    (s) => s.card.status === "pending" && (s.isNew || (s.before < NOTIFY_AGAIN_AT && s.card.visitors >= NOTIFY_AGAIN_AT)),
  );
  told.sort((a, b) => b.card.visitors - a.card.visitors);
  return told[0]?.card ?? null;
}

/** grouped: the turn answered and what it decided was saved. asleep: no credits or no room in the cap — no model call.
 *  failed: the provider failed (the real brain doesn't throw: the loop returns its errorCode) — nothing saved or charged,
 *  no attempt added. nothing: no assistant or nothing waiting. */
export type GroupOutcome = "grouped" | "asleep" | "failed" | "nothing";

export async function groupOne(pair: { readonly assistantId: string; readonly projectId: string }, deps?: GrouperDeps): Promise<GroupOutcome> {
  const d = deps ?? (await defaultGrouperDeps());
  const assistant = await d.assistantOf(pair.assistantId);
  if (!assistant) return "nothing";
  const requests = await d.store.pendingRequests(pair.assistantId, pair.projectId, GROUP_BATCH);
  if (requests.length === 0) return "nothing";

  const owner = assistant.personId;
  const now = d.now();
  const month = visitorMonth(now);
  const [credit, spent, explicit] = await Promise.all([d.creditState(owner), d.monthSpent(owner, month), d.explicitVisitorCap(owner)]);
  const cap = visitorCap(explicit, credit.allotment);
  if (sleepReason({ balance: credit.balance, spent, inFlight: visitorReservations.reserved(owner), cap })) return "asleep";
  const release = visitorReservations.tryReserve(owner, spent, VISITOR_TURN_RESERVE, cap);
  if (!release) return "asleep";
  try {
    const cards = await d.store.joinableCards(pair.assistantId, pair.projectId, now);
    // The page's language when they asked: the newest request's.
    const locale = requests[requests.length - 1]!.locale;
    const recorder = d.recorder?.({ projectId: pair.projectId, turnId: randomUUID(), tag: `assistant-requests:${pair.assistantId}` });
    const tools = [GROUP_REQUESTS_DECLARATION as unknown as Record<string, unknown>];
    const brain = d.brain(tools, recorder ? (c) => recorder.onCall(c) : undefined);
    let args: unknown = undefined;
    let steps = 0;
    let endReason = "error";
    const runTool = async (name: string, a: Record<string, unknown>): Promise<ToolOutcome> => {
      // The loop refuses what wasn't declared; this is the second gate.
      if (name !== GROUP_REQUESTS) return { response: { ok: false, error: NOT_GIVEN } };
      args = a;
      // Its answer is the call: the turn ends here, with no further model call.
      return { response: { ok: true, tool_result: "Saved." }, final: true };
    };
    let result: AgentLoopResult;
    try {
      result = await (d.runLoop ?? runAgentLoop)({
        messages: groupingMessages({ assistantName: assistant.name, locale, requests, cards }),
        tools,
        openStream: (messages) => (++steps <= GROUP_MAX_STEPS ? brain.openStream(messages) : brain.closeOut(messages)),
        closeOut: brain.closeOut,
        runTool: (name, a) => runTool(name, (a ?? {}) as Record<string, unknown>),
        emit: () => {},
        unattended: true,
        ...(recorder ? { onStepTools: (b: readonly ToolOutcomeSummary[]) => recorder.onStepTools(b) } : {}),
      });
      endReason = result.errorCode ? "error" : "done";
    } finally {
      try {
        recorder?.finish({ endReason });
      } catch {
        // telemetry never touches the turn
      }
    }

    // The provider failed before answering — it ends the stream with an error, it doesn't throw (final review C1):
    // nothing saved, nothing charged, no attempt added; the requests wait. A throw above ends the same way.
    if (args === undefined && result.errorCode) return "failed";
    // From here the turn happened.
    const saved = await d.store.saveGrouping({ assistantId: pair.assistantId, projectId: pair.projectId, locale, at: now, ...applyGrouping({ requests, cards, args }) });
    const uses = brain.providersUsed().map((u) => ({ provider: u.provider, model: u.model, inputTokens: u.inputTokens, cachedTokens: u.cachedTokens, outputTokens: u.outputTokens, reasoningTokens: u.thinkingTokens }));
    let centicredits = 0;
    try {
      centicredits = await d.charge({ ownerId: owner, projectId: pair.projectId, refId: `requests:${pair.assistantId}:${pair.projectId}:${now.toISOString()}`, usage: result.usage, uses });
    } catch (err) {
      console.error("[assistant-requests] the grouping couldn't be charged", err);
    }
    if (centicredits > 0) await d.addMonthSpend(owner, month, centicredits, 0).catch((err: unknown) => console.warn("[assistant-requests] the month's spend wasn't added", err));

    // At most three notices a day per pair (final review I6): past that, the cards still reach the chat and «Pedidos».
    const card = worthTelling(saved);
    const roomToTell = card ? (await d.store.noticesSince(pair, new Date(now.getTime() - 86_400_000)).catch(() => 0)) < NOTICES_PER_PAIR_DAY : false;
    if (card && roomToTell) {
      const url = `${d.siteUrl}/new?project=${encodeURIComponent(pair.projectId)}&chat=1&card=${encodeURIComponent(card.id)}`;
      const email = requestEmail(card.locale, { name: assistant.name, title: card.title, visitors: card.visitors, url });
      try {
        await d.notify(
          {
            type: "len_aviso",
            projectId: pair.projectId,
            recipientUserId: owner,
            cardId: card.id,
            title: assistant.name,
            push: pushText(card.visitors > 1 ? `${card.title} (${card.visitors})` : card.title),
            emailSubject: email.subject,
            emailText: email.text,
          },
          // Keyed by the pair: a notice still waiting (quiet hours) is replaced by the newest.
          `assistant_requests:${pair.assistantId}:${pair.projectId}`,
        );
        await d.store.markNotified(card.id, now).catch((err: unknown) => console.warn("[assistant-requests] the notice wasn't counted", err));
      } catch (err) {
        console.warn("[assistant-requests] the owner couldn't be told", err);
      }
    }
    return "grouped";
  } finally {
    release();
  }
}

/** The real parts, wired like the visitor's turn (lib/assistants/visitor/turn.ts). */
async function defaultGrouperDeps(): Promise<GrouperDeps> {
  const [{ createAgentBrain }, { streamWithRetry }, { creditsForUsage, chargeCredits, getCreditState }, policy, store, visitorStore, { assistantById }, { createStepRecorder }, { createStepStore }, { drizzleStepStoreDb }] = await Promise.all([
    import("@/lib/agent/brain"),
    import("@/lib/agent/retry"),
    import("@/lib/credits"),
    import("@/lib/generation/model-policy"),
    import("./store"),
    import("../visitor/store"),
    import("../store"),
    import("@/lib/agent/telemetry/step-recorder"),
    import("@/lib/agent/telemetry/step-store"),
    import("@/lib/agent/telemetry/step-store-db"),
  ]);
  const stepStore = createStepStore(drizzleStepStoreDb, { log: console.warn });
  return {
    now: () => new Date(),
    assistantOf: async (id) => {
      const a = await assistantById(id);
      return a ? { id: a.id, name: a.name, personId: a.personId } : null;
    },
    creditState: async (ownerId) => {
      const s = await getCreditState(ownerId);
      return { balance: s.balance, allotment: s.allotment };
    },
    monthSpent: visitorStore.monthSpent,
    addMonthSpend: visitorStore.addMonthSpend,
    explicitVisitorCap: visitorStore.explicitVisitorCap,
    brain: (tools, onCall) => {
      const brain = createAgentBrain({ tools, requestId: "assistant-requests", esfuerzoDelTurno: "low", ...(onCall ? { onCall } : {}) });
      return {
        openStream: (m) => streamWithRetry(() => brain.openStream(m), {}),
        closeOut: (m) => streamWithRetry(() => brain.closeOut(m), {}),
        providersUsed: () => brain.providersUsed(),
      };
    },
    charge: async (c) => {
      const rate = policy.creditRateForRole(policy.roleForOperation("assistant_requests"));
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
    notify: async (event, dedupeKey) => {
      const { scheduleNotification } = await import("@/lib/notifications/dispatch");
      await scheduleNotification(event, dedupeKey);
    },
    store,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com",
    recorder: ({ projectId, turnId, tag }) => createStepRecorder({ projectId, turnId, hasHistory: false, store: stepStore, log: console.warn, subagentId: tag }),
  };
}
