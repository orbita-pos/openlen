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
import { runSubagent } from "@/lib/agent/subagente";
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import type { LedgerUse } from "@/lib/credit-ledger";
import { creditsForUsage } from "@/lib/credits";
import { creditRateForRole, roleForOperation } from "@/lib/generation/model-policy";
import type { AppDeProyecto } from "@/lib/projects/types";

import { settlementNotice, type SubagentStatus, type SubagentStopReason } from "./notice";
import { childSystemPrompt, childToolDeclarations, isReadOnly, omitsLenMd, type SubagentPreset } from "./presets";
import { noticeTurnPending, queueNotice, release, reserve, setNoticeTurnPending } from "./registry";
import type { TurnSpend } from "./spend";
import { SUBAGENT_GUIDANCE, type SubagentsDeps } from "./tool";

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
  createRun(r: { id: string; projectId: string; chatRowId: string; turnId: string; personId: string; preset: string; description: string; prompt: string }): Promise<void>;
  saveProgress(id: string, p: { transcript: unknown; actions: unknown[]; toolUses: number }): Promise<void>;
  settleRun(
    id: string,
    s: { status: SubagentStopReason; finalText: string; diagnostic: string | null; transcript: unknown; actions: unknown[]; usage: unknown; toolUses: number; durationMs: number; chargedCenticredits: number },
  ): Promise<void>;
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

/** The child's messages: the launching turn's pieces with no history and its task as the request; Explore
 *  and Plan without LEN.md and the person's notes (Claude Code's `omitClaudeMd`). */
export function childMessages(turnArgs: BuildAgentMessagesArgs, preset: SubagentPreset, prompt: string): Message[] {
  const built = buildAgentMessages({
    ...turnArgs,
    history: [],
    prompt,
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

export function createSubagentLauncher(ctx: LaunchContext, io: RunnerIO): SubagentsDeps {
  const rate = creditRateForRole(roleForOperation("subagent"));
  const centicreditsOf = (g: Usage) => (g.inputTokens + g.outputTokens > 0 ? Math.max(1, creditsForUsage(g.inputTokens, g.outputTokens, rate, g.cachedTokens)) : 0);
  const log = io.log ?? ((line: string) => console.warn(line));

  async function run(id: string, o: { description: string; prompt: string; preset: SubagentPreset }, abort: AbortController): Promise<void> {
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
      ...(isReadOnly(o.preset, ctx.planMode) ? { readOnly: true as const } : {}),
    } as AgentSession;
    const tools = childToolDeclarations(ctx.declarations, o.preset, ctx.planMode);
    // Depth 1: the child has no launcher of its own; its stop is its own.
    const deps: AgentDeps = { ...ctx.deps, subagents: undefined, turnSignal: abort.signal };
    const actions: Omit<Extract<AgentStreamEvent, { type: "action" }>, "type">[] = [];
    let toolUses = 0;
    const live: { read: (() => Message[]) | null } = { read: null };
    let result: AgentLoopResult | null = null;
    let diagnostic: string | null = null;
    let before: Readonly<Record<string, string>> | null = null;
    let brain: SubagentBrain | null = null;
    const progress = () => io.store.saveProgress(id, { transcript: live.read?.() ?? null, actions, toolUses }).catch(() => undefined);
    const timer = setInterval(() => void progress(), PROGRESS_EVERY_MS);
    timer.unref?.();
    const stopFlush = io.flushOnExit?.(progress);
    try {
      await io.openTerminal(session, id);
      before = await io.snapshot(session).catch(() => null);
      const b = (brain = io.brain(tools, id, abort.signal));
      result = await runSubagent({
        messages: childMessages(ctx.turnArgs, o.preset, o.prompt),
        tools,
        openStream: (m) => b.openStream(m),
        closeOut: (m) => b.closeOut(m),
        signal: abort.signal,
        runTool: (name, args) => io.runTool(session, deps, name, args),
        emit: (ev) => {
          if (ev.type !== "action") return;
          const { type: _type, ...step } = ev;
          if (step.status !== "running") toolUses++;
          const i = actions.findIndex((a) => a.tool === step.tool && a.status === "running");
          if (step.status !== "running" && i >= 0) actions[i] = step;
          else actions.push(step);
          ctx.emit?.({ type: "subagent", id, preset: o.preset, description: o.description, status: "running", step });
        },
        liveTranscript: (read) => {
          live.read = read;
        },
        lateNotices: async () => {
          const t = session.terminal as { finishedBackground?: (owner?: string) => Promise<string[]> } | undefined;
          return (await t?.finishedBackground?.(id).catch(() => [])) ?? [];
        },
        excedePresupuesto: (g) => g.inputTokens + g.outputTokens > 0 && ctx.spend.over(centicreditsOf(g)),
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
    ctx.spend.addChildren(charged);
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
    if (before && !io.turnStillOpen(ctx.chatRowId)) {
      const after = await io.snapshot(session).catch(() => null);
      if (after) await io.addTurnChanges(ctx.projectId, ctx.chatRowId, before, after).catch((e: unknown) => log(`[subagents] run=${id} undo failed: ${String(e)}`));
    }
    await io.closeTerminal(session, id).catch((e: unknown) => log(`[subagents] run=${id} closing its terminal failed: ${String(e)}`));
    const finalText = status === "error" && !result ? "" : (result?.finalText ?? "");
    await io.store
      .settleRun(id, {
        status,
        finalText,
        diagnostic,
        transcript: result?.transcripcion ?? live.read?.() ?? null,
        actions,
        usage,
        toolUses,
        durationMs: Math.max(0, io.now() - startedAt),
        chargedCenticredits: charged,
      })
      .catch((e: unknown) => log(`[subagents] run=${id} settle failed: ${String(e)}`));
    // The notice first, then the slot: a turn waiting for «a notice or no child left» must see the notice.
    queueNotice(ctx.projectId, { id, text: settlementNotice({ id, stopReason: status, closingText: finalText, ...(diagnostic ? { diagnostic } : {}) }) });
    release(ctx.projectId, id);
    ctx.emit?.({ type: "subagent", id, preset: o.preset, description: o.description, status });
    if (!io.turnAlive(ctx.projectId) && !noticeTurnPending(ctx.projectId)) {
      setNoticeTurnPending(ctx.projectId, true);
      io.launchNoticeTurn(ctx.projectId, ctx.personId);
    }
  }

  return {
    async launch(o) {
      if (ctx.spend.over()) return { ok: false, code: "turn_budget_reached", message: TURN_BUDGET_REACHED };
      const id = io.newId();
      const abort = new AbortController();
      if (!reserve(ctx.projectId, id, abort)) return { ok: false, code: "too_many_subagents", message: TOO_MANY_SUBAGENTS };
      try {
        await io.store.createRun({ id, projectId: ctx.projectId, chatRowId: ctx.chatRowId, turnId: ctx.turnId, personId: ctx.personId, preset: o.preset, description: o.description, prompt: o.prompt });
      } catch (e) {
        release(ctx.projectId, id);
        throw e;
      }
      ctx.emit?.({ type: "subagent", id, preset: o.preset, description: o.description, status: "running" });
      void run(id, o, abort).catch((e: unknown) => log(`[subagents] run=${id} crashed: ${String(e)}`));
      return { ok: true, id };
    },
  };
}
