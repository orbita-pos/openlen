// THE LAUNCHER OF LEN'S SUBAGENTS (spec local 2026-11-01-subagentes-de-len, §4.3–§4.10): what
// `deps.subagents.launch` does. It takes a slot (8 per project), saves the run, answers at once, and runs
// the child without waiting: a fresh session on the same project and person, Len's prompt with its type,
// its own tools (presets.ts), the skills and the catalog Len has but its own loaded skills, the project's
// shared box, and Len's loop with no turn cap (`runSubagent`). When it ends it charges the owner, counts in
// the launching turn's cap, joins that turn's undo if the turn already closed, saves the run, and leaves its
// notice (DeepSeek's, notice.ts) for the live turn — or, with Len idle, for a server turn.
//
// Everything that touches the world comes in `RunnerIO`, so the tests run it with scripted streams and no
// database: the agent route wires the real parts.
//
// Cache effect: the child's request is its own conversation (Len's system prompt and catalog, then its task);
// Len's prefix is untouched, and the notice is appended to Len's conversation later.

import type { Message } from "@/lib/ai-gateway";
import { buildAgentMessages, type BuildAgentMessagesArgs } from "@/lib/agent/context";
import type { AgentMode } from "@/lib/agent/dynamis";
import type { AgentLoopArgs, AgentLoopResult, AgentStreamEvent } from "@/lib/agent/loop";
import { withPlanSection } from "@/lib/agent/plan-mode";
import { runSubagent } from "@/lib/agent/subagente";
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import type { LedgerUse } from "@/lib/credit-ledger";
import { creditsForUsage } from "@/lib/credits";
import { creditRateForRole, roleForOperation } from "@/lib/generation/model-policy";
import type { AppDeProyecto } from "@/lib/projects/types";

import { SEND_MESSAGE_TOOL } from "./enabled";
import { agentMessage, LEN_AGENT_ID, settlementNotice, withContinuableReturnGuidance, type SubagentStatus, type SubagentStopReason } from "./notice";
import { childSystemPrompt, childToolDeclarations, DELEGATION_SCOPE_STATEMENT, isReadOnly, omitsLenMd, SUBAGENT_PRESETS, type SubagentPreset } from "./presets";
import { isLive, noticeTurnPending, queueNotice, release, reserve, sendToRun, setNoticeTurnPending, stop, takeRunInbox } from "./registry";
import type { ConversationRun, SubagentRunRow } from "./store";
import type { TurnSpend } from "./spend";
import { messageDeliveredLine, notYourParentError, SUBAGENT_GUIDANCE, unavailableError, type SendResult, type SubagentsDeps } from "./tool";

/** What the chat hears about a child: it started, a step, how it ended. */
export interface SubagentEvent {
  readonly type: "subagent";
  readonly id: string;
  readonly preset: SubagentPreset;
  readonly description: string;
  readonly status: SubagentStatus;
  readonly step?: Omit<Extract<AgentStreamEvent, { type: "action" }>, "type">;
}

/** What the launching turn hands its children. */
export interface LaunchContext {
  readonly projectId: string;
  /** Pays. */
  readonly ownerId: string;
  /** The session's user (the owner when a member talks: the project's tools filter by owner). */
  readonly userId: string;
  /** Who is talking: the woken turn runs as them. */
  readonly personId: string;
  readonly turnId: string;
  readonly chatRowId: string;
  readonly mode: AgentMode;
  readonly app: AppDeProyecto | null;
  readonly planMode: boolean;
  /** The launching turn's message pieces: the child's are built from them (`childMessages`). */
  readonly turnArgs: BuildAgentMessagesArgs;
  /** Len's system prompt this turn: a woken child's is rebuilt from it (a fork's is it, byte for byte). */
  readonly lenSystemPrompt: string;
  /** Len's request up to, not including, this turn's message: the completed turns a fork inherits (DeepSeek's
   *  `completedTurnPrefix`), captured when it is created. Its first message is Len's system prompt. */
  readonly forkSeed: readonly Message[];
  /** Len's tool declarations: the child gets its preset's share (`childToolDeclarations`). */
  readonly declarations: readonly Record<string, unknown>[];
  /** Len's deps, without what only the turn has (questions, plan mode, goal, scheduled tasks). */
  readonly deps: AgentDeps;
  readonly sessionBase: Pick<AgentSession, "skills" | "attachments" | "uiLocale" | "zonaHoraria" | "ownerEmail">;
  readonly spend: TurnSpend;
  /** While the launching turn's stream is open. */
  readonly emit?: (ev: SubagentEvent) => void;
  readonly isMember: boolean;
}

/** The brain a child talks to: Len's (`createAgentBrain`), with the child's tools. */
export interface SubagentBrain {
  openStream(messages: Message[]): AsyncIterable<import("@/lib/ai-gateway").StreamEvent>;
  closeOut(messages: Message[]): AsyncIterable<import("@/lib/ai-gateway").StreamEvent>;
  readonly modelId: string;
  lastProvider(): LedgerUse["provider"];
}

export interface SubagentRunStore {
  createRun(r: { id: string; projectId: string; chatRowId: string; turnId: string; personId: string; preset: string; description: string; prompt: string; forked: boolean }): Promise<void>;
  saveProgress(id: string, p: { transcript: unknown; actions: unknown[]; toolUses: number }): Promise<void>;
  settleRun(
    id: string,
    s: { status: SubagentStopReason; finalText: string; diagnostic: string | null; transcript: unknown; actions: unknown[]; usage: unknown; toolUses: number; durationMs: number; chargedCenticredits: number },
  ): Promise<void>;
  /** A settled run runs again, as `personId` (who woke it): true only for the call that reopened it. */
  reopenRun(id: string, personId: string): Promise<boolean>;
  /** Len's children: the runs of the project's current conversation, with only what his list needs. */
  runsOfCurrentConversation(projectId: string): Promise<ConversationRun[]>;
  /** One of them, whole (its transcript); null when it is not his. */
  runOfCurrentConversation(projectId: string, id: string): Promise<SubagentRunRow | null>;
}

export interface RunnerIO {
  /** `signal`: the child's own stop (its card's ■, the project deleted), never the launching turn's. */
  brain(tools: Record<string, unknown>[], runId: string, signal: AbortSignal): SubagentBrain;
  runTool(session: AgentSession, deps: AgentDeps, name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  readonly store: SubagentRunStore;
  /** Charges the owner (ledger surface `subagent`); the centicredits that moved. */
  charge(o: { ownerId: string; actorId: string | null; projectId: string; refId: string; centicredits: number; listCenticredits: number; uses: LedgerUse[] }): Promise<number>;
  /** Gives the session its terminal: the project's shared box when there is one (`holderId` = the run). */
  openTerminal(session: AgentSession, holderId: string): Promise<void>;
  closeTerminal(session: AgentSession, holderId: string): Promise<void>;
  /** Whether a Len turn of the project is alive: it takes the notice before its next call. */
  turnAlive(projectId: string): boolean;
  /** A server turn that carries the queued notices to Len (it takes them when it starts). */
  launchNoticeTurn(projectId: string, personId: string): void;
  /** Whether the launching turn's row is still open: its closing photo then covers the child's changes. */
  turnStillOpen(chatRowId: string): boolean;
  snapshot(session: AgentSession): Promise<Readonly<Record<string, string>>>;
  addTurnChanges(projectId: string, chatRowId: string, before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>): Promise<void>;
  /** Closes the child's browser tab (`use_page`), if it opened one. */
  closeBrowser?(session: AgentSession): Promise<void>;
  /** What the route builds for any loop of the session: compaction, spill, late diagnostics. */
  loopExtras?(session: AgentSession): Partial<Pick<AgentLoopArgs, "compaction" | "spill" | "lateDiagnostics">>;
  /** Writes what the run has before the process exits (exit-flush.ts); returns its unregister. */
  flushOnExit?(flush: () => Promise<void>): () => void;
  now(): number;
  newId(): string;
  log?(line: string): void;
}

export const TOO_MANY_SUBAGENTS = "8 subagents are already running in this project; wait for one to finish.";
const TURN_BUDGET_REACHED = "This turn's spending limit is reached: no more subagents can start in it.";
const PROGRESS_EVERY_MS = 5_000;

/** The child's messages: the launching turn's pieces with no history and its task as the request, closed by
 *  DeepSeek's return guidance (it reports to `len`); Explore and Plan without LEN.md and the person's notes
 *  (Claude Code's `omitClaudeMd`). */
export function childMessages(turnArgs: BuildAgentMessagesArgs, preset: SubagentPreset, prompt: string): Message[] {
  const built = buildAgentMessages({
    ...turnArgs,
    history: [],
    prompt: withContinuableReturnGuidance(prompt),
    attachedImages: [],
    attachedFiles: undefined,
    seleccion: null,
    selecciones: undefined,
    mentionedFiles: undefined,
    design: null,
    todoRestore: null,
    ...(omitsLenMd(preset) ? { memoryMessage: null, userMemory: null } : {}),
  });
  if (!built.ok) throw new Error("the subagent's task does not fit");
  const [system, ...rest] = built.messages;
  return [{ ...system!, content: childSystemPrompt(built.systemPrompt, preset, SUBAGENT_GUIDANCE) }, ...rest];
}

type Usage = AgentLoopResult["usage"];
const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thinkingTokens: 0 };
type ChildStep = Omit<Extract<AgentStreamEvent, { type: "action" }>, "type">;

/** One run of a child: a fresh one, a fork, or one woken by Len's message. */
interface ChildSpec {
  readonly id: string;
  readonly description: string;
  readonly preset: SubagentPreset;
  /** A `subagent_fork` child: its requests are Len's, plan section included. */
  readonly forked: boolean;
  /** The conversation it starts from, its system prompt first. */
  readonly messages: Message[];
  /** What it is offered; `allowed`, what it may run when narrower (a fork). */
  readonly tools: Record<string, unknown>[];
  readonly allowed?: ReadonlySet<string>;
  /** What the row already counts: a woken child adds to it. */
  readonly prior: { readonly toolUses: number; readonly durationMs: number; readonly charged: number; readonly actions: readonly ChildStep[] };
}

const NOTHING_YET: ChildSpec["prior"] = { toolUses: 0, durationMs: 0, charged: 0, actions: [] };

export function createSubagentLauncher(ctx: LaunchContext, io: RunnerIO): SubagentsDeps {
  const rate = creditRateForRole(roleForOperation("subagent"));
  const centicreditsOf = (g: Usage) => (g.inputTokens + g.outputTokens > 0 ? Math.max(1, creditsForUsage(g.inputTokens, g.outputTokens, rate, g.cachedTokens)) : 0);
  const log = io.log ?? ((line: string) => console.warn(line));

  async function run(spec: ChildSpec, abort: AbortController): Promise<void> {
    const { id, preset, description } = spec;
    const startedAt = io.now();
    const session: AgentSession = {
      ...ctx.sessionBase,
      projectId: ctx.projectId,
      userId: ctx.userId,
      ...(ctx.personId !== ctx.userId ? { personId: ctx.personId } : {}),
      turnId: ctx.turnId,
      terminalHolderId: id,
      mode: ctx.mode,
      app: ctx.app,
      page: null,
      imageEditsThisTurn: 0,
      photoSearchesThisTurn: 0,
      busquedasVaciasSeguidas: 0,
      leidos: new Map(),
      loadedSkills: new Set(),
      ...(isReadOnly(preset, ctx.planMode) ? { readOnly: true as const } : {}),
    } as AgentSession;
    const tools = spec.tools;
    // Depth 1: the child has no launcher of its own; its stop is its own.
    const deps: AgentDeps = { ...ctx.deps, subagents: undefined, turnSignal: abort.signal };
    const actions: ChildStep[] = [];
    let toolUses = 0;
    /** The files its tools wrote: its undo is only these (others may change the project meanwhile). */
    const touched = new Set<string>();
    const live: { read: (() => Message[]) | null } = { read: null };
    /** Its last act was a `send_message` to Len: the settlement then omits the closing message (DeepSeek). */
    let omitClosingText = false;
    const initial = spec.messages;
    /** What the run keeps: its whole conversation but the system prompt, so it can be woken later. */
    const conversation = (own: readonly Message[]) => [...initial.slice(1), ...own];
    const allActions = () => [...spec.prior.actions, ...actions];
    let result: AgentLoopResult | null = null;
    let diagnostic: string | null = null;
    let before: Readonly<Record<string, string>> | null = null;
    let brain: SubagentBrain | null = null;
    const progress = () =>
      io.store.saveProgress(id, { transcript: conversation(live.read?.() ?? []), actions: allActions(), toolUses: spec.prior.toolUses + toolUses }).catch(() => undefined);
    const timer = setInterval(() => void progress(), PROGRESS_EVERY_MS);
    timer.unref?.();
    const stopFlush = io.flushOnExit?.(progress);
    try {
      await io.openTerminal(session, id);
      before = await io.snapshot(session).catch(() => null);
      const b = (brain = io.brain(tools, id, abort.signal));
      result = await runSubagent({
        messages: initial,
        tools,
        ...(spec.allowed ? { allowed: spec.allowed } : {}),
        // A fork's request is Len's as he sends it, with the plan section of now (`withPlanSection`): his cache.
        openStream: (m) => b.openStream(spec.forked ? withPlanSection(m, ctx.planMode) : m),
        closeOut: (m) => b.closeOut(spec.forked ? withPlanSection(m, ctx.planMode) : m),
        signal: abort.signal,
        runTool: async (name, args) => {
          if (name === SEND_MESSAGE_TOOL) return sendToLen(args);
          // A tool call after its message: the closing message may report what the message didn't.
          omitClosingText = false;
          const out = await io.runTool(session, deps, name, args);
          for (const f of out.ficherosTocados ?? []) touched.add(f.ruta);
          return out;
        },
        emit: (ev) => {
          if (ev.type !== "action") return;
          const { type: _type, ...step } = ev;
          if (step.status !== "running") toolUses++;
          const i = actions.findIndex((a) => a.tool === step.tool && a.status === "running");
          if (step.status !== "running" && i >= 0) actions[i] = step;
          else actions.push(step);
          ctx.emit?.({ type: "subagent", id, preset, description, status: "running", step });
        },
        liveTranscript: (read) => {
          live.read = read;
        },
        // What Len sent it while it works, at its next step (DeepSeek: a working agent receives it then).
        takeAgentNotices: () => {
          const inbox = takeRunInbox(id);
          if (inbox.length > 0) omitClosingText = false;
          return inbox.map((text) => agentMessage(LEN_AGENT_ID, text));
        },
        lateNotices: async () => {
          const t = session.terminal as { finishedBackground?: (owner?: string) => Promise<string[]> } | undefined;
          return (await t?.finishedBackground?.(id).catch(() => [])) ?? [];
        },
        // Its spend so far counts for Len and the other children too (`track`), not only for itself.
        excedePresupuesto: (g) => {
          if (g.inputTokens + g.outputTokens === 0) return false;
          ctx.spend.track(id, centicreditsOf(g));
          return ctx.spend.over();
        },
        ...io.loopExtras?.(session),
      });
    } catch (e) {
      diagnostic = "internal_error";
      log(`[subagents] run=${id} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearInterval(timer);
      stopFlush?.();
    }
    const status: SubagentStopReason = abort.signal.aborted
      ? "aborted"
      : result?.topeAlcanzado === "budget_limit"
        ? "budget"
        : !result || result.terminalError
          ? "error"
          : "completed";
    if (status === "error") diagnostic ??= result?.errorCode ?? "error";
    const usage = result?.usage ?? NO_USAGE;
    const charged = centicreditsOf(usage);
    ctx.spend.settle(id, charged);
    if (charged > 0) {
      await io
        .charge({
          ownerId: ctx.ownerId,
          actorId: ctx.isMember ? ctx.personId : null,
          projectId: ctx.projectId,
          refId: id,
          centicredits: charged,
          listCenticredits: charged,
          uses: [
            {
              provider: brain!.lastProvider(),
              model: brain!.modelId,
              inputTokens: usage.inputTokens,
              cachedTokens: usage.cachedTokens,
              outputTokens: usage.outputTokens,
              reasoningTokens: usage.thinkingTokens,
            },
          ],
        })
        .catch((e: unknown) => log(`[subagents] run=${id} charge failed: ${String(e)}`));
    }
    if (before && touched.size > 0 && !io.turnStillOpen(ctx.chatRowId)) {
      const after = await io.snapshot(session).catch(() => null);
      if (after) {
        const own = (files: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(files).filter(([path]) => touched.has(path)));
        await io.addTurnChanges(ctx.projectId, ctx.chatRowId, own(before), own(after)).catch((e: unknown) => log(`[subagents] run=${id} undo failed: ${String(e)}`));
      }
    }
    await io.closeTerminal(session, id).catch((e: unknown) => log(`[subagents] run=${id} closing its terminal failed: ${String(e)}`));
    await io.closeBrowser?.(session).catch((e: unknown) => log(`[subagents] run=${id} closing its browser failed: ${String(e)}`));
    const finalText = status === "error" && !result ? "" : (result?.finalText ?? "");
    const own = result?.transcripcion ?? live.read?.() ?? [];
    const settled = {
      status,
      finalText,
      diagnostic,
      actions: allActions(),
      usage,
      toolUses: spec.prior.toolUses + toolUses,
      durationMs: spec.prior.durationMs + Math.max(0, io.now() - startedAt),
      chargedCenticredits: spec.prior.charged + charged,
    };
    /** What Len sent that this run won't act on: it waits in the transcript for the next wake. */
    const kept: Message[] = [];
    const save = () =>
      io.store.settleRun(id, { ...settled, transcript: [...conversation(own), ...kept] }).catch((e: unknown) => log(`[subagents] run=${id} settle failed: ${String(e)}`));
    /** Keeps what Len sends until none is left; the slot goes right after, with nothing in between. */
    const keepTheRest = async () => {
      for (let more = takeRunInbox(id); more.length > 0; more = takeRunInbox(id)) {
        kept.push(...more.map(fromLen));
        await save();
      }
    };
    await save();
    if (status !== "completed") {
      // A stop sticks, and a failed or capped run doesn't go on (DeepSeek's cancel keeps the inbox).
      await keepTheRest();
    } else {
      // Len's message landed while it was closing: it goes on with it in this activation and slot, and Len hears once,
      // when it is done (DeepSeek: pending input holds the settlement).
      const pending = takeRunInbox(id);
      if (pending.length > 0) {
        if (await goOn(pending)) return;
        kept.push(...pending.map(fromLen));
        await save();
        await keepTheRest();
      }
    }
    // The notice first, then the slot: a turn waiting for «a notice or no child left» must see the notice.
    queueNotice(ctx.projectId, {
      id,
      text: settlementNotice({ id, stopReason: status, closingText: finalText, ...(diagnostic ? { diagnostic } : {}), omitClosingText }),
    });
    release(ctx.projectId, id);
    ctx.emit?.({ type: "subagent", id, preset, description, status });
    wakeLen();

    /** Goes on with Len's messages, holding its slot: the row runs again and the next pass adds to this one's counts. */
    async function goOn(texts: readonly string[]): Promise<boolean> {
      try {
        if (!(await io.store.reopenRun(id, ctx.personId))) return false;
      } catch (e) {
        log(`[subagents] run=${id} could not go on: ${String(e)}`);
        return false;
      }
      const next: ChildSpec = {
        ...spec,
        messages: [initial[0]!, ...conversation(own), ...texts.map(fromLen)],
        prior: { toolUses: settled.toolUses, durationMs: settled.durationMs, charged: settled.chargedCenticredits, actions: settled.actions },
      };
      void run(next, abort).catch((e: unknown) => log(`[subagents] run=${id} crashed: ${String(e)}`));
      return true;
    }

    /** The child's `send_message`: only to its parent, `len`; it reaches him like a notice (DeepSeek's). */
    function sendToLen(args: Record<string, unknown>): ToolOutcome {
      const target = typeof args.agent_id === "string" ? args.agent_id.trim() : "";
      const text = typeof args.message === "string" ? args.message.trim() : "";
      if (target !== LEN_AGENT_ID) return { response: { ok: false, error: notYourParentError(id, target) } };
      if (!text) return { response: { ok: false, error: "invalid_arguments", message: "message is required." } };
      queueNotice(ctx.projectId, { id, text: agentMessage(id, text), message: true });
      wakeLen();
      omitClosingText = true;
      return { response: { ok: true, tool_result: messageDeliveredLine(LEN_AGENT_ID) } };
    }
  }

  /** With Len idle, a server turn carries what waits for him (one at a time per project). */
  function wakeLen(): void {
    if (!io.turnAlive(ctx.projectId) && !noticeTurnPending(ctx.projectId)) {
      setNoticeTurnPending(ctx.projectId, true);
      io.launchNoticeTurn(ctx.projectId, ctx.personId);
    }
  }

  /** Len's message as the child reads it in its conversation. */
  const fromLen = (text: string): Message => ({ role: "user", content: agentMessage(LEN_AGENT_ID, text) });

  const presetOf = (p: string): SubagentPreset => ((SUBAGENT_PRESETS as readonly string[]).includes(p) ? (p as SubagentPreset) : "general-purpose");

  /** Len's message for one of his children: into its inbox if it works, or it wakes from its transcript. */
  async function resume(id: string, texts: readonly string[]): Promise<SendResult> {
    const first = await io.store.runOfCurrentConversation(ctx.projectId, id);
    if (!first) return { ok: false, code: "unavailable", message: unavailableError(id) };
    const preset = presetOf(first.preset);
    const toInbox = (): SendResult => {
      for (const t of texts) sendToRun(id, t);
      return { ok: true, resumed: false, preset, description: first.description };
    };
    if (isLive(ctx.projectId, id)) return toInbox();
    if (ctx.spend.over()) return { ok: false, code: "turn_budget_reached", message: TURN_BUDGET_REACHED };
    const abort = new AbortController();
    if (!reserve(ctx.projectId, id, abort)) return { ok: false, code: "too_many_subagents", message: TOO_MANY_SUBAGENTS };
    let reopened: boolean;
    try {
      reopened = await io.store.reopenRun(id, ctx.personId);
    } catch (e) {
      release(ctx.projectId, id);
      throw e;
    }
    if (!reopened) {
      // Someone else woke it meanwhile: it works now, so the message waits in its inbox.
      release(ctx.projectId, id);
      return isLive(ctx.projectId, id) ? toInbox() : { ok: false, code: "unavailable", message: unavailableError(id) };
    }
    // Read again now that it is ours: what a stop kept in its transcript while this message was on its way.
    const row = (await io.store.runOfCurrentConversation(ctx.projectId, id).catch(() => null)) ?? first;
    const spec: ChildSpec = {
      id,
      description: row.description,
      preset,
      forked: row.forked,
      messages: [
        { role: "system", content: row.forked ? ctx.lenSystemPrompt : childSystemPrompt(ctx.lenSystemPrompt, preset, SUBAGENT_GUIDANCE) },
        ...((row.transcript as Message[] | null) ?? []),
        ...texts.map(fromLen),
      ],
      ...(row.forked
        ? { tools: [...ctx.declarations], allowed: generalPurposeNames() }
        : { tools: childToolDeclarations(ctx.declarations, preset, ctx.planMode) }),
      prior: { toolUses: row.toolUses, durationMs: row.durationMs ?? 0, charged: row.chargedCenticredits, actions: row.actions as ChildStep[] },
    };
    ctx.emit?.({ type: "subagent", id, preset, description: row.description, status: "running" });
    void run(spec, abort).catch((e: unknown) => log(`[subagents] run=${id} crashed: ${String(e)}`));
    return { ok: true, resumed: true, preset, description: row.description };
  }

  /** Whether `id` is one of Len's children: a run of the project's current conversation. */
  const ofThisConversation = async (id: string) => (await io.store.runsOfCurrentConversation(ctx.projectId)).some((r) => r.id === id);

  /** Len's tools a general-purpose child may run: a fork is declared all of Len's (his cached prefix) and gated to these. */
  const generalPurposeNames = () => new Set(childToolDeclarations(ctx.declarations, "general-purpose", ctx.planMode).map((d) => String(d.name)));

  return {
    async launch(o) {
      if (ctx.spend.over()) return { ok: false, code: "turn_budget_reached", message: TURN_BUDGET_REACHED };
      const id = io.newId();
      const abort = new AbortController();
      if (!reserve(ctx.projectId, id, abort)) return { ok: false, code: "too_many_subagents", message: TOO_MANY_SUBAGENTS };
      try {
        await io.store.createRun({ id, projectId: ctx.projectId, chatRowId: ctx.chatRowId, turnId: ctx.turnId, personId: ctx.personId, preset: o.preset, description: o.description, prompt: o.prompt, forked: false });
      } catch (e) {
        release(ctx.projectId, id);
        throw e;
      }
      ctx.emit?.({ type: "subagent", id, preset: o.preset, description: o.description, status: "running" });
      const spec: ChildSpec = {
        id,
        description: o.description,
        preset: o.preset,
        forked: false,
        messages: childMessages(ctx.turnArgs, o.preset, o.prompt),
        tools: childToolDeclarations(ctx.declarations, o.preset, ctx.planMode),
        prior: NOTHING_YET,
      };
      void run(spec, abort).catch((e: unknown) => log(`[subagents] run=${id} crashed: ${String(e)}`));
      return { ok: true, id };
    },
    // DeepSeek's fork: Len's system prompt, tools and completed turns as they are, so his cached prefix carries over;
    // the delegation statement and the return guidance go in its task (a context contribution in DeepSeek, not a
    // system-prompt section). Always general-purpose.
    async fork(o) {
      if (ctx.spend.over()) return { ok: false, code: "turn_budget_reached", message: TURN_BUDGET_REACHED };
      const id = io.newId();
      const abort = new AbortController();
      if (!reserve(ctx.projectId, id, abort)) return { ok: false, code: "too_many_subagents", message: TOO_MANY_SUBAGENTS };
      try {
        await io.store.createRun({ id, projectId: ctx.projectId, chatRowId: ctx.chatRowId, turnId: ctx.turnId, personId: ctx.personId, preset: "general-purpose", description: o.description, prompt: o.prompt, forked: true });
      } catch (e) {
        release(ctx.projectId, id);
        throw e;
      }
      ctx.emit?.({ type: "subagent", id, preset: "general-purpose", description: o.description, status: "running" });
      const spec: ChildSpec = {
        id,
        description: o.description,
        preset: "general-purpose",
        forked: true,
        messages: [...ctx.forkSeed, { role: "user", content: withContinuableReturnGuidance(`${o.prompt}\n\n${DELEGATION_SCOPE_STATEMENT}`) }],
        tools: [...ctx.declarations],
        allowed: generalPurposeNames(),
        prior: NOTHING_YET,
      };
      void run(spec, abort).catch((e: unknown) => log(`[subagents] run=${id} crashed: ${String(e)}`));
      return { ok: true, id };
    },
    send: ({ id, message }) => resume(id, [message]),
    async interrupt(id) {
      return isLive(ctx.projectId, id) && (await ofThisConversation(id)) && stop(id);
    },
    async list() {
      return (await io.store.runsOfCurrentConversation(ctx.projectId)).map((r) => ({
        id: r.id,
        label: r.description,
        status: isLive(ctx.projectId, r.id) ? ("running" as const) : ("inactive" as const),
      }));
    },
  };
}
