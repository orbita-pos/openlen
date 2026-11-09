// A VISITOR'S TURN WITH THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio, §4.2, §4.7, §5): Len's loop
// on Len's brain with the `assistant-visitor` definition, started by a message in the published page's bubble — no
// `/api/agent`, like the event tasks' judge (lib/event-tasks/judge.ts). A closed list (`offer_handoff`, Len's visuals and,
// when the business has some, its public data), low effort and five calls, then `closeOut`. Its system prompt is the same for every visitor of the business (one cached prefix);
// what the visit kept and the visitor's words go after it. Paid by the owner within the month's cap; with no room or no
// credits it sleeps before calling the model.
import "server-only";

import { randomUUID } from "node:crypto";

import type { Message, StreamEvent } from "@/lib/ai-gateway";
import type { BrainCall, ProviderUse } from "@/lib/agent/brain";
import { runAgentLoop, type AgentLoopResult } from "@/lib/agent/loop";
import type { ToolOutcomeSummary } from "@/lib/agent/telemetry/step-signals";
import type { ToolOutcome } from "@/lib/agent/tools";
import { toolReadMe, toolShowWidget } from "@/lib/agent/visuals/tools";
import { READ_ME, SHOW_WIDGET, type VisualWidget } from "@/lib/agent/visuals/widget";
import { CLAVE_TOOL_RESULT, fallo } from "@/lib/agent/ficheros/resultado";
import type { PublicTable } from "@/lib/db/schema";

import type { AssistantTone } from "../names";
import { sleepReason, VISITOR_TURN_RESERVE, visitorCap, visitorMonth, visitorReservations, type Sleep } from "./budget";
import { OFFER_HANDOFF, REPLY_MAX, replyText, visitorMessage, visitorSystemPrompt, visitorTools } from "./definition";
import { READ_PUBLIC_DATA, readPublicData } from "./read-public-data";
import type * as VisitorStore from "./store";

/** Calls with tools before it must answer (the definition's `maxTurns`). */
export const VISITOR_MAX_STEPS = 5;
/** Her visuals in one answer, and how long each may be (phase 2B). */
export const VISITOR_MAX_VISUALS = 2;
export const VISITOR_VISUAL_MAX_CHARS = 30_000;
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
  /** What the page's data shows anyone (phase 2B); [] = no read_public_data. */
  readonly publicData: readonly PublicTable[];
  readonly signal?: AbortSignal;
}

/** A visual of hers in the answer; `at` = where it goes in `text`. */
export interface VisitorVisual {
  readonly title: string | null;
  readonly code: string;
  readonly at: number;
}

export type VisitorTurnResult =
  | { readonly kind: "reply"; readonly text: string; readonly intent: "answer" | "handoff" | "lead"; readonly visuals: readonly VisitorVisual[] }
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
  /** Layer 0 (lib/agent/telemetry/): one recorder per turn, its rows tagged with `tag` (the `subagentId` column, which
   *  keeps them out of Len's baseline). */
  recorder?(o: { projectId: string; turnId: string; tag: string }): { onCall(c: BrainCall): void; onStepTools(b: readonly ToolOutcomeSummary[]): void; finish(end: { endReason: string }): void };
  /** `read_public_data` (./read-public-data.ts by default). */
  readPublicData?(projectId: string, query: string, tables: readonly PublicTable[]): Promise<ToolOutcome>;
  runLoop?: typeof runAgentLoop;
  /** For the tests: the turn's limit. `VISITOR_TURN_TIMEOUT_MS` by default. */
  timeoutMs?: number;
}

/** The visits in flight in this process: one turn at a time per visitor. */
const running = new Set<string>();

function refused(message: string): ToolOutcome {
  const r = fallo(message);
  return { response: { ok: false, error: r.error, [CLAVE_TOOL_RESULT]: r.texto } };
}

/** A finished tool call in her turn: where her words stood when it ended, and its visual if it drew one. */
interface Boundary {
  readonly offset: number;
  readonly widget: VisualWidget | null;
}

/** What the visitor reads, from what she wrote in the whole turn cut at each finished tool call (final review I3):
 *  the words before a visual introduce it and stay; the words before any other tool are a preamble («Déjame
 *  revisar.») and go; the last words always stay. Pieces are tidied one by one and joined with a blank line — never
 *  glued. If nothing is left and there is no visual, what she said is all she said. A visual never gets lost. */
function placeVisuals(raw: string, boundaries: readonly Boundary[]): { text: string; visuals: VisitorVisual[] } {
  let text = "";
  let from = 0;
  const visuals: VisitorVisual[] = [];
  const dropped: string[] = [];
  const add = (piece: string) => {
    const tidy = replyText(piece);
    if (tidy) text = text ? `${text}\n\n${tidy}` : tidy;
  };
  for (const b of boundaries) {
    const at = Math.min(Math.max(from, b.offset), raw.length);
    const piece = raw.slice(from, at);
    from = at;
    if (b.widget) {
      add(piece);
      visuals.push({ title: b.widget.title, code: b.widget.code, at: text.length });
    } else dropped.push(piece);
  }
  add(raw.slice(from));
  if (!text && visuals.length === 0) for (const piece of dropped) add(piece);
  const capped = text.slice(0, REPLY_MAX);
  return { text: capped, visuals: visuals.map((v) => ({ ...v, at: Math.min(v.at, capped.length) })) };
}

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
      // Telling the owner never costs the visitor the asleep line and the form.
      try {
        if (await d.store.claimAsleepAlert(input.ownerId, month, reason)) {
          await d.notifyAsleep({ ownerId: input.ownerId, projectId: input.projectId, assistantName: input.assistant.name, assistantSlug: input.assistant.slug, reason, month, spent, cap });
        }
      } catch (err) {
        console.warn("[assistant-visitor] the owner couldn't be told she fell asleep", err);
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
        publicData: input.publicData,
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
    // Her rows are tagged as hers: Len's baseline never compares against a visitor's prefix, nor hers against Len's.
    const recorder = d.recorder?.({ projectId: input.projectId, turnId: randomUUID(), tag: `assistant-visitor:${input.assistant.id}` });
    const tools = [...visitorTools(input.publicData)];
    const brain = d.brain(tools, recorder ? (c) => recorder.onCall(c) : undefined, signal);
    /** She offered a way to reach the business (the reply's intent). */
    let offered = false;
    /** The visitor asked for a person (what «Conversaciones» says), not only that she offered the contact form. */
    let askedForPerson = false;
    let steps = 0;
    let endReason = "error";
    /** What she wrote in the whole turn, and where each visual went in it — as Len's chat records it
     *  (lib/agent/registro-del-turno.ts): a retry or a compaction takes back what it discarded. */
    let written = "";
    const boundaries: Boundary[] = [];
    let shownVisuals = 0;
    const runTool = async (name: string, args: Record<string, unknown>): Promise<ToolOutcome> => {
      // The loop refuses what wasn't declared; this is the second gate of a list that must not grow by accident.
      if (name === OFFER_HANDOFF) {
        offered = true;
        if (args.why === "person") askedForPerson = true;
        return {
          response: {
            ok: true,
            tool_result: input.handoffAvailable ? "The visitor now sees a button to talk to a person here." : "The visitor now sees a form to leave their name and email.",
          },
        };
      }
      if (name === READ_ME) return toolReadMe(args, "bubble");
      if (name === SHOW_WIDGET) {
        if (shownVisuals >= VISITOR_MAX_VISUALS) return refused(`At most ${VISITOR_MAX_VISUALS} visuals in one answer: say the rest in words.`);
        const code = typeof args.widget_code === "string" ? args.widget_code : "";
        if (code.length > VISITOR_VISUAL_MAX_CHARS) return refused(`A visual in the bubble can be at most ${VISITOR_VISUAL_MAX_CHARS} characters: make it smaller.`);
        const out = toolShowWidget(args);
        if (out.widget) shownVisuals++;
        return out;
      }
      if (name === READ_PUBLIC_DATA && input.publicData.length > 0) {
        return (d.readPublicData ?? readPublicData)(input.projectId, typeof args.query === "string" ? args.query : "", input.publicData);
      }
      return { response: { ok: false, error: NOT_GIVEN } };
    };
    const result = await (d.runLoop ?? runAgentLoop)({
      messages: [system, ...prior, ask],
      tools,
      openStream: (messages) => (++steps <= VISITOR_MAX_STEPS ? brain.openStream(messages) : brain.closeOut(messages)),
      closeOut: brain.closeOut,
      runTool: (name, args) => runTool(name, (args ?? {}) as Record<string, unknown>),
      emit: (ev) => {
        if (ev.type === "text") written += ev.text;
        else if ((ev.type === "retry" || ev.type === "compaction") && ev.discardChars > 0) written = written.slice(0, Math.max(0, written.length - ev.discardChars));
        // Every finished call cuts her words; a visual is kept with the words that introduce it.
        else if (ev.type === "action" && ev.status !== "running") boundaries.push({ offset: written.length, widget: ev.widget ?? null });
      },
      unattended: true,
      signal,
      ...(recorder ? { onStepTools: (b: readonly ToolOutcomeSummary[]) => recorder.onStepTools(b) } : {}),
    })
      .then((r) => ((endReason = "done"), r))
      .finally(() => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onLeave);
        // Closed whatever happened: a failed turn's rows say so.
        try {
          recorder?.finish({ endReason });
        } catch {
          // telemetry never touches the turn
        }
      });
    // Everything she wrote this turn (the visual sits between her words), or the final text if nothing was streamed.
    const { text, visuals } = placeVisuals(written.trim() ? written : (result.finalText ?? ""), written.trim() ? boundaries : []);
    const uses = brain.providersUsed().map((u) => ({ provider: u.provider, model: u.model, inputTokens: u.inputTokens, cachedTokens: u.cachedTokens, outputTokens: u.outputTokens, reasoningTokens: u.thinkingTokens }));
    // A billing failure never loses the answer the visitor is waiting for; what wasn't charged isn't counted either.
    let centicredits = 0;
    try {
      centicredits = await d.charge({ ownerId: input.ownerId, projectId: input.projectId, refId: key, usage: result.usage, uses });
    } catch (err) {
      console.error("[assistant-visitor] the turn couldn't be charged", err);
    }
    if (centicredits > 0) await d.store.addMonthSpend(input.ownerId, month, centicredits).catch((err: unknown) => console.warn("[assistant-visitor] the month's spend wasn't added", err));
    const at = now.toISOString();
    try {
      await d.store.saveVisit({
        assistantId: input.assistant.id,
        projectId: input.projectId,
        visitorId: input.visitorId,
        transcript: kept([...prior, ask, ...(result.transcripcion ?? [])]),
        newLines: [
          { role: "visitor", text: input.message, at },
          ...(text || visuals.length
            ? [{ role: "assistant" as const, text, at, ...(visuals.length ? { visuals: visuals.map((v) => ({ title: v.title, code: v.code })) } : {}) }]
            : []),
        ],
        centicredits,
        handedOff: askedForPerson,
        at: now,
      });
    } catch (err) {
      // Deleted while it answered (its visits went with it): the visitor still gets the reply.
      console.warn("[assistant-visitor] the visit wasn't saved", err);
    }
    return { kind: "reply", text, intent: offered ? (input.handoffAvailable ? "handoff" : "lead") : "answer", visuals };
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
    // No baseline from earlier turns (the store's is Len's); within the turn her calls compare with each other.
    recorder: ({ projectId, turnId, tag }) => createStepRecorder({ projectId, turnId, hasHistory: false, store: stepStore, log: console.warn, subagentId: tag }),
  };
}
