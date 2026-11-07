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
import type { LaunchOptions } from "./tool";
import { buildAgentMessages, type BuildAgentMessagesArgs } from "@/lib/agent/context";
import type { AgentMode } from "@/lib/agent/dynamis";
import type { AgentLoopArgs, AgentLoopResult, AgentStreamEvent } from "@/lib/agent/loop";
import { withPlanSection } from "@/lib/agent/plan-mode";
import { runSubagent } from "@/lib/agent/subagente";
import type { CompactionMark } from "@/lib/agent/compaction/mark";
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import type { LedgerUse } from "@/lib/credit-ledger";
import { creditsForUsage } from "@/lib/credits";
import { creditRateForRole, roleForOperation } from "@/lib/generation/model-policy";
import type { AppDeProyecto } from "@/lib/projects/types";
import type { NivelEsfuerzo } from "@/lib/agent/esfuerzo";
import { skillsEnabled } from "@/lib/agent/skills/enabled";
import { renderSkillContent } from "@/lib/agent/skills/tool";
import { gitEnabled } from "@/lib/git/enabled";

import { SEND_MESSAGE_TOOL } from "./enabled";
import type { AgentTypeSet } from "./agent-registry";
import {
  agentMessage,
  isolationLine,
  LEN_AGENT_ID,
  settlementNotice,
  withContinuableReturnGuidance,
  type SubagentStatus,
  type SubagentStopReason,
  type WorktreeOutcome,
} from "./notice";
import { HIDDEN_AGENT_TYPES } from "./agent-paths";
import type { AgentWorktree, FinishedWorktree } from "./worktree";
import { childSystemPromptFor, childToolDeclarations, childToolsFor, childTypeOf, DELEGATION_SCOPE_STATEMENT, isReadOnlyFor, omitsLenMdFor, type ChildType, type SubagentPreset } from "./presets";
import { finalizingInput, isLive, noticeTurnPending, queueNotice, release, reserve, sendToRun, setFinalizingInput, setNoticeTurnPending, stop, takeRunInbox } from "./registry";
import type { ConversationRun, SubagentRunRow } from "./store";
import type { TurnSpend } from "./spend";
import {
  belongsToAnotherParentError,
  messageDeliveredLine,
  parentGoneError,
  SUBAGENT_GUIDANCE,
  unavailableError,
  type SendResult,
  type SubagentsDeps,
} from "./tool";

/** What the chat hears about a child: it started, a step, how it ended. */
export interface SubagentEvent {
  readonly type: "subagent";
  readonly id: string;
  readonly preset: string;
  readonly description: string;
  readonly status: SubagentStatus;
  readonly step?: Omit<Extract<AgentStreamEvent, { type: "action" }>, "type">;
  /** An isolated child (phase 4): working in its copy, then how the copy came back. */
  readonly worktree?: { readonly state: "working" } | WorktreeOutcome;
}

/** What the launching turn hands its children. */
export interface LaunchContext {
  readonly agentTypes: AgentTypeSet;
  readonly refreshAgentTypes?: () => Promise<void>;
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
  readonly sessionBase: Pick<AgentSession, "skills" | "attachments" | "uiLocale" | "zonaHoraria" | "ownerEmail" | "tool" | "game" | "ownerPaid">;
  readonly spend: TurnSpend;
  /** While the launching turn's stream is open. */
  readonly emit?: (ev: SubagentEvent) => void;
  readonly isMember: boolean;
  /** The launching session is read-only (the person's own assistant, spec local 2026-11-06-asistente-propio): its
   *  children are too, whatever their type — like plan mode, without plan mode's prompt. */
  readonly readOnly?: true;
}

/** The brain a child talks to: Len's (`createAgentBrain`), with the child's tools. */
export interface SubagentBrain {
  openStream(messages: Message[]): AsyncIterable<import("@/lib/ai-gateway").StreamEvent>;
  closeOut(messages: Message[]): AsyncIterable<import("@/lib/ai-gateway").StreamEvent>;
  readonly modelId: string;
  lastProvider(): LedgerUse["provider"];
}

export interface SubagentRunStore {
  createRun(r: { id: string; projectId: string; chatRowId: string; turnId: string; personId: string; preset: string; description: string; prompt: string; forked: boolean; planMode: boolean }): Promise<void>;
  saveProgress(id: string, p: { transcript: unknown; actions: unknown[]; toolUses: number; durationMs: number }): Promise<void>;
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
  /** Phase 4: an isolated child's copy, and how it came back. */
  setWorktree?(id: string, w: AgentWorktree): Promise<void>;
  setWorktreeOutcome?(id: string, o: WorktreeOutcome): Promise<void>;
}

export interface RunnerIO {
  /** `signal`: the child's own stop (its card's ■, the project deleted), never the launching turn's. */
  brain(tools: Record<string, unknown>[], runId: string, signal: AbortSignal, effort?: NivelEsfuerzo): SubagentBrain;
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
  /** Phase 4 (`isolation: "worktree"`): the child's copy of the project (lib/agent/subagents/worktree.ts). Without
   *  them, isolation is dropped and logged. */
  addWorktree?(o: { parentId: string; ownerId: string; runId: string }): Promise<AgentWorktree>;
  /** Brings the copy back into the draft with `session` (the launching turn's, on the parent) and removes it. */
  finishWorktree?(o: { w: AgentWorktree; description: string; session: AgentSession }): Promise<FinishedWorktree>;
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
/** Ours: the custom type's model-call cap, followed by one tools-off closing call. */
export const TURN_LIMIT_MESSAGE = "You have reached this agent's turn limit. Do not call any more tools: answer now with what you did, what you found and what is left undone.";
/** Ours (phase 4): a launch that asked for isolation never runs in the shared folder instead. Like Claude Code's
 *  «Failed to create worktree», it says what failed and suggests nothing: «start it without isolation» sent Len to
 *  write in the shared folder, next to the children isolation was keeping apart. */
const WORKTREE_FAILED = "The subagent's own copy of the project could not be made, so it did not start.";
const PROGRESS_EVERY_MS = 5_000;

/** The child's messages: the launching turn's pieces with no history and its task as the request, closed by
 *  DeepSeek's return guidance (it reports to `len`); Explore and Plan without LEN.md and the person's notes
 *  (Claude Code's `omitClaudeMd`). */
export function childMessages(turnArgs: BuildAgentMessagesArgs, preset: SubagentPreset | ChildType, prompt: string): Message[] {
  const type: ChildType = typeof preset === "string" ? { kind: "builtin", preset } : preset;
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
    ...(omitsLenMdFor(type) ? { memoryMessage: null, userMemory: null } : {}),
  });
  if (!built.ok) throw new Error("the subagent's task does not fit");
  const [system, ...rest] = built.messages;
  return [{ ...system!, content: childSystemPromptFor(built.systemPrompt, type, SUBAGENT_GUIDANCE) }, ...rest];
}

type Usage = AgentLoopResult["usage"];
const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thinkingTokens: 0 };
const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cachedTokens: a.cachedTokens + b.cachedTokens,
  thinkingTokens: a.thinkingTokens + b.thinkingTokens,
});
/** A saved row's usage, whatever jsonb gives back. */
const usageOf = (v: unknown): Usage => {
  const u = (v ?? {}) as Partial<Record<keyof Usage, unknown>>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return { inputTokens: n(u.inputTokens), outputTokens: n(u.outputTokens), cachedTokens: n(u.cachedTokens), thinkingTokens: n(u.thinkingTokens) };
};

/** What the database keeps of a message: its text, never its photos (`Message.images`: «nunca se guardan»). */
const withoutImages = (m: Message): Message => {
  if (!m.images) return m;
  const { images: _images, ...rest } = m;
  return rest;
};

/** After its last message to Len, did it call anything or read anything new? Then its closing message may say what the
 *  message didn't (DeepSeek voids the omission on any logged call, refused ones too, and on claimed input). */
function actedAfterMessagingLen(own: readonly Message[]): boolean {
  for (let i = own.length - 1; i >= 0; i--) {
    const calls = own[i]!.functionCalls ?? [];
    const last = calls.map((c) => c.name).lastIndexOf(SEND_MESSAGE_TOOL);
    if (last < 0) continue;
    if (last < calls.length - 1) return true;
    // Its tool results come right after; anything else said or called later counts.
    return own.slice(i + 2).some((m) => (m.role === "assistant" && (m.functionCalls?.length ?? 0) > 0) || (m.role === "user" && !m.functionResponses?.length));
  }
  return false;
}
type ChildStep = Omit<Extract<AgentStreamEvent, { type: "action" }>, "type">;

/** One run of a child: a fresh one, a fork, or one woken by Len's message. */
interface ChildSpec {
  readonly id: string;
  readonly description: string;
  readonly preset: string;
  readonly type: ChildType;
  /** A `subagent_fork` child: its requests are Len's, plan section included. */
  readonly forked: boolean;
  /** The conversation it starts from, its system prompt first. */
  readonly messages: Message[];
  /** What it is offered; `allowed`, what it may run when narrower (a fork). */
  readonly tools: Record<string, unknown>[];
  readonly allowed?: ReadonlySet<string>;
  /** Read-only by plan mode: when it started, or now (a scope never widens from inside; DeepSeek fixes it at start). */
  readonly planMode: boolean;
  /** What the row already counts: a woken child adds to it. */
  readonly prior: { readonly toolUses: number; readonly durationMs: number; readonly charged: number; readonly usage: Usage; readonly actions: readonly ChildStep[] };
  /** Phase 4: it works in this copy, which comes back into the draft when it ends. */
  readonly worktree?: AgentWorktree;
  /** DeepSeek's activation output: declared `structured_output`, whose call ends the run. */
  readonly outputSchema?: LaunchOptions["outputSchema"];
  /** DeepSeek's `delivery: "caller"`: the result goes to `onSettled`, never to Len as a notice. */
  readonly delivery?: "caller";
  readonly onSettled?: LaunchOptions["onSettled"];
}

/** DeepSeek's structured output tool, declared to a child launched with an output schema. */
export const STRUCTURED_OUTPUT_TOOL = "structured_output";

function structuredOutputDeclaration(schema: NonNullable<LaunchOptions["outputSchema"]>): Record<string, unknown> {
  return {
    name: STRUCTURED_OUTPUT_TOOL,
    description: "Return the final result for this task. Call it once, as your last step.",
    parameters: {
      type: "OBJECT",
      properties: Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, { type: v.type.toUpperCase() }])),
      required: [...schema.required],
    },
  };
}

/** Whether a structured_output call fits its schema: every required field, each of its declared JSON type. */
function fitsSchema(args: Record<string, unknown>, schema: NonNullable<LaunchOptions["outputSchema"]>): string | null {
  for (const key of schema.required) if (!(key in args)) return `missing "${key}"`;
  for (const [key, def] of Object.entries(schema.properties)) {
    if (!(key in args)) continue;
    const v = args[key];
    const actual = Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
    if (actual !== def.type) return `"${key}" must be ${def.type}`;
  }
  return null;
}

/** Server-owned state on a preload message, kept in its transcript but not sent as provider content. */
type PreloadedMessage = Message & { readonly loadedSkill?: string; readonly runningSkill?: string };

const NOTHING_YET: ChildSpec["prior"] = { toolUses: 0, durationMs: 0, charged: 0, usage: NO_USAGE, actions: [] };

export function createSubagentLauncher(ctx: LaunchContext, io: RunnerIO): SubagentsDeps {
  const rate = creditRateForRole(roleForOperation("subagent"));
  const centicreditsOf = (g: Usage) => (g.inputTokens + g.outputTokens > 0 ? Math.max(1, creditsForUsage(g.inputTokens, g.outputTokens, rate, g.cachedTokens)) : 0);
  const log = io.log ?? ((line: string) => console.warn(line));

  function preload(type: ChildType, messages: Message[]): Message[] {
    if (type.kind !== "custom") return messages;
    const preloaded: PreloadedMessage[] = [];
    for (const name of type.type.agent.skills) {
      const skill = ctx.sessionBase.skills?.get(name);
      if (!skillsEnabled() || !skill || !skill.skill.modelInvocable) {
        log(`[subagents] type=${type.type.agent.name} skipped preload ${name}: ${!skillsEnabled() ? "skills disabled" : !skill ? "unavailable" : "not model-invocable"}`);
        continue;
      }
      preloaded.push({ role: "user", content: renderSkillContent(skill), loadedSkill: name });
    }
    if (!preloaded.length) return messages;
    // Ours: the catalog's generic invocation rule must not ask the child to load these again.
    const notice: Message = { role: "user", content: `Already loaded skills: ${preloaded.map((m) => m.loadedSkill).join(", ")}. Their full instructions follow below and are active for this task. Follow them directly; do not call skill to load them again.` };
    return [...messages.slice(0, -1), notice, ...preloaded, messages.at(-1)!];
  }

  async function run(spec: ChildSpec, abort: AbortController): Promise<void> {
    const { id, preset, description } = spec;
    const running = spec.messages.findLast((m: PreloadedMessage) => !!m.runningSkill) as PreloadedMessage | undefined;
    const startedAt = io.now();
    /** What its `structured_output` handed back (DeepSeek's activation output). */
    let structured: Record<string, unknown> | null = null;
    const session: AgentSession = {
      ...ctx.sessionBase,
      // An isolated child works in its copy; its LEN.md, memory, skills and agents stay its parent's (phase 4).
      projectId: spec.worktree ? spec.worktree.copyId : ctx.projectId,
      ...(spec.worktree ? { parentProjectId: ctx.projectId } : {}),
      userId: ctx.userId,
      ...(ctx.personId !== ctx.userId ? { personId: ctx.personId } : {}),
      turnId: ctx.turnId,
      terminalHolderId: id,
      isSubagent: true,
      mode: ctx.mode,
      app: ctx.app,
      page: null,
      imageEditsThisTurn: 0,
      photoSearchesThisTurn: 0,
      busquedasVaciasSeguidas: 0,
      leidos: new Map(),
      loadedSkills: new Set(spec.messages.flatMap((m: PreloadedMessage) => m.loadedSkill ? [m.loadedSkill] : [])),
      ...(running?.runningSkill ? { runningSkill: running.runningSkill } : {}),
      ...(isReadOnlyFor(spec.type, spec.planMode || ctx.readOnly === true) ? { readOnly: true as const } : {}),
    } as AgentSession;
    const tools = spec.tools;
    // Depth 1: the child has no launcher of its own; its stop is its own.
    // An installed tool's operations are the main turn's only (spec local 2026-11-04-herramientas-hechas-por-len, §4.7).
    const deps: AgentDeps = { ...ctx.deps, subagents: undefined, toolOperations: undefined, turnSignal: abort.signal };
    const actions: ChildStep[] = [];
    let toolUses = 0;
    /** The files its tools wrote: its undo is only these (others may change the project meanwhile). */
    const touched = new Set<string>();
    const live: { read: (() => Message[]) | null } = { read: null };
    /** Its last act was a `send_message` to Len: the settlement then omits the closing message (DeepSeek). */
    let omitClosingText = false;
    const initial = spec.messages;
    // Its compaction is the route's, and the latest summary it made is kept here (Len keeps his in the turn's row).
    const extras = io.loopExtras?.(session);
    // Preloaded instructions are part of the fixed head, so the summary keeps their bodies and state.
    const firstIndex = Math.max(extras?.compaction?.firstIndex ?? 1, initial.findLastIndex((m: PreloadedMessage) => !!m.loadedSkill || !!m.runningSkill) + 1);
    let mark: CompactionMark | null = null;
    const loopExtras = extras?.compaction
      ? {
          ...extras,
          compaction: {
            ...extras.compaction,
            firstIndex,
            saveMark: async (m: CompactionMark) => {
              mark = m;
              await extras.compaction?.saveMark?.(m);
            },
          },
        }
      : extras;
    /** What the run keeps, so it can be woken later: its conversation but the system prompt — after a summary, what
     *  it saw from then on (Claude Code's compact boundary, as Len's own history does), not its whole record. */
    const conversation = (own: readonly Message[]): Message[] =>
      mark ? [...initial.slice(1, firstIndex), ...mark.messages, ...own.slice(mark.fromTranscript)] : [...initial.slice(1), ...own];
    const allActions = () => [...spec.prior.actions, ...actions];
    let result: AgentLoopResult | null = null;
    let diagnostic: string | null = null;
    let before: Readonly<Record<string, string>> | null = null;
    let brain: SubagentBrain | null = null;
    let calls = 0;
    let turnLimitReached = false;
    const definition = spec.type.kind === "custom" ? spec.type.type.agent : null;
    const elapsed = () => spec.prior.durationMs + Math.max(0, io.now() - startedAt);
    /** Saved only when it changed: a fork's conversation carries Len's whole one. */
    let lastSaved = "";
    const progress = () => {
      const transcript = conversation(live.read?.() ?? []);
      const all = allActions();
      const total = spec.prior.toolUses + toolUses;
      const shape = `${transcript.length}:${all.length}:${total}`;
      if (shape === lastSaved) return Promise.resolve();
      lastSaved = shape;
      return io.store.saveProgress(id, { transcript: transcript.map(withoutImages), actions: all, toolUses: total, durationMs: elapsed() }).catch(() => undefined);
    };
    const timer = setInterval(() => void progress(), PROGRESS_EVERY_MS);
    timer.unref?.();
    const stopFlush = io.flushOnExit?.(progress);
    try {
      await io.openTerminal(session, id);
      // An isolated child's changes undo with what its copy brought back, not with a photo of the copy.
      if (!spec.worktree) before = await io.snapshot(session).catch(() => null);
      const b = (brain = io.brain(tools, id, abort.signal, definition?.effort ?? undefined));
      result = await runSubagent({
        messages: initial,
        tools,
        ...(spec.allowed ? { allowed: spec.allowed } : {}),
        // A fork's request is Len's as he sends it, with the plan section of now (`withPlanSection`): his cache.
        openStream: (m) => {
          const request = spec.forked ? withPlanSection(m, ctx.planMode) : m;
          if (definition?.maxTurns !== null && definition?.maxTurns !== undefined && calls >= definition.maxTurns) {
            turnLimitReached = true;
            omitClosingText = false;
            return b.closeOut([...request, { role: "user", content: TURN_LIMIT_MESSAGE }]);
          }
          calls++;
          return b.openStream(request);
        },
        closeOut: (m) => b.closeOut(spec.forked ? withPlanSection(m, ctx.planMode) : m),
        signal: abort.signal,
        runTool: async (name, args) => {
          if (name === SEND_MESSAGE_TOOL) {
            if (spec.delivery === "caller") return { response: { ok: false, error: "Your result goes to OpenLen through structured_output, not to Len: there is no one to message." } };
            return sendToLen(args);
          }
          if (name === STRUCTURED_OUTPUT_TOOL && spec.outputSchema) {
            const wrong = fitsSchema(args, spec.outputSchema);
            if (wrong) return { response: { ok: false, error: `structured_output doesn't fit its schema: ${wrong}` } };
            structured = { ...args };
            return { response: { ok: true }, final: true };
          }
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
        ...loopExtras,
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
          : turnLimitReached ? "turn_limit" : "completed";
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
    if (omitClosingText && actedAfterMessagingLen(own)) omitClosingText = false;
    const settled = {
      status,
      finalText,
      diagnostic,
      actions: allActions(),
      usage: addUsage(spec.prior.usage, usage),
      toolUses: spec.prior.toolUses + toolUses,
      durationMs: elapsed(),
      chargedCenticredits: spec.prior.charged + charged,
    };
    /** What Len sent that this run won't act on: it waits in the transcript for the next wake. */
    const kept: Message[] = [];
    let copyPending = !!spec.worktree;
    let saving = Promise.resolve();
    const persist = () => {
      const next = saving.catch(() => undefined).then(() => {
        const transcript = [...conversation(own), ...kept].map(withoutImages);
        return copyPending
          ? io.store.saveProgress(id, { transcript, actions: settled.actions, toolUses: settled.toolUses, durationMs: settled.durationMs })
          : io.store.settleRun(id, { ...settled, transcript });
      });
      saving = next;
      return next;
    };
    const save = () => persist().catch((e: unknown) => log(`[subagents] run=${id} settle failed: ${String(e)}`));
    /** Keeps what Len sends until none is left; the slot goes right after, with nothing in between. */
    const keepTheRest = async () => {
      for (let more = takeRunInbox(id); more.length > 0; more = takeRunInbox(id)) {
        kept.push(...more.map(fromLen));
        await save();
      }
    };
    await save();
    // A child of a conversation that was archived tells the new one nothing. Asked here, before the inbox: from the
    // last look at it to the slot there is no wait.
    const toLen = await ofThisConversation(id).catch(() => true);
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
    // An isolated child's copy comes back now: after its terminal closed (which saved into the copy what the box
    // changed), and before its notice and its slot, so Len hears how it came back (phase 4, spec §4.3).
    let receivedWhileFinishing = 0;
    setFinalizingInput(id, async texts => {
      kept.push(...texts.map(fromLen));
      receivedWhileFinishing += texts.length;
      // Delivery is acknowledged only after the accepted input is durable, including during a restart.
      await persist();
    });
    const worktree = spec.worktree ? await finishCopy(spec.worktree) : undefined;
    copyPending = false;
    // No await between the final stable save and releasing the inbox: a new delivery forces another save.
    for (;;) {
      const revision = receivedWhileFinishing;
      await keepTheRest();
      await save();
      if (revision === receivedWhileFinishing) break;
    }
    // The notice first, then the slot: a turn waiting for «a notice or no child left» must see the notice.
    if (toLen && spec.delivery !== "caller") {
      queueNotice(ctx.projectId, {
        id,
        text: settlementNotice({ id, stopReason: status, closingText: finalText, ...(diagnostic ? { diagnostic } : {}), omitClosingText, ...(worktree ? { worktree } : {}) })
          // Ours: accepted input cannot run in the copy that has just been removed.
          + (receivedWhileFinishing ? "\n\nMessages received while it was finishing are saved for its next activation; use send_message to wake it again." : ""),
      });
    }
    release(ctx.projectId, id);
    ctx.emit?.({ type: "subagent", id, preset, description, status, ...(worktree ? { worktree } : {}) });
    if (toLen && spec.delivery !== "caller") wakeLen();
    if (spec.delivery === "caller") {
      void spec.onSettled?.({ id, status, structured, finalText }).catch((e: unknown) => log(`[subagents] run=${id} onSettled failed: ${String(e)}`));
    }

    async function finishCopy(w: AgentWorktree): Promise<WorktreeOutcome> {
      const { parentProjectId: _parent, ...rest } = session;
      let finished: FinishedWorktree;
      try {
        finished = await io.finishWorktree!({ w, description, session: { ...rest, projectId: ctx.projectId } as AgentSession });
      } catch (e) {
        log(`[subagents] run=${id} its copy could not come back: ${String(e)}`);
        finished = { outcome: { state: "kept", branch: w.branch, copyId: w.copyId }, changes: null };
      }
      await io.store.setWorktreeOutcome?.(id, finished.outcome).catch((e: unknown) => log(`[subagents] run=${id} saving its copy's outcome failed: ${String(e)}`));
      if (finished.changes && !io.turnStillOpen(ctx.chatRowId)) {
        await io.addTurnChanges(ctx.projectId, ctx.chatRowId, finished.changes.before, finished.changes.after).catch((e: unknown) => log(`[subagents] run=${id} undo failed: ${String(e)}`));
      }
      return finished.outcome;
    }

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
        prior: { toolUses: settled.toolUses, durationMs: settled.durationMs, charged: settled.chargedCenticredits, usage: settled.usage, actions: settled.actions },
      };
      void run(next, abort).catch((e: unknown) => log(`[subagents] run=${id} crashed: ${String(e)}`));
      return true;
    }

    /** The child's `send_message`: only to its parent, `len`; it reaches him like a notice. Anyone else gets DeepSeek's
     *  answer: one of Len's children belongs to another parent, the rest is unavailable. */
    async function sendToLen(args: Record<string, unknown>): Promise<ToolOutcome> {
      const target = typeof args.agent_id === "string" ? args.agent_id.trim() : "";
      const text = typeof args.message === "string" ? args.message.trim() : "";
      if (target !== LEN_AGENT_ID) {
        const sibling = await ofThisConversation(target).catch(() => false);
        return { response: { ok: false, error: sibling ? belongsToAnotherParentError(target) : unavailableError(target) } };
      }
      if (!text) return { response: { ok: false, error: "invalid_arguments", message: "message is required." } };
      // Its conversation was archived: the Len it worked for is gone.
      if (!(await ofThisConversation(id).catch(() => true))) return { response: { ok: false, error: parentGoneError() } };
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

  /** Len's message for one of his children: into its inbox if it works, or it wakes from its transcript. */
  async function resume(id: string, texts: readonly string[]): Promise<SendResult> {
    const first = await io.store.runOfCurrentConversation(ctx.projectId, id);
    if (!first) return { ok: false, code: "unavailable", message: unavailableError(id) };
    // A hidden type (the «Crear» card's creator) reports to whoever launched it, never to Len: woken by a message it
    // would run without its output schema and its hand-back, and the card would never hear.
    if (HIDDEN_AGENT_TYPES.has(first.preset)) {
      return { ok: false, code: "unavailable", message: `Subagent ${id} hands its result to OpenLen, not to you; it can't be sent messages.` };
    }
    const preset = first.preset;
    const toInbox = (): SendResult => {
      for (const t of texts) sendToRun(id, t);
      return { ok: true, resumed: false, preset, description: first.description };
    };
    if (isLive(ctx.projectId, id)) {
      const closing = finalizingInput(id);
      if (closing) { await closing(texts); return { ok: true, resumed: false, preset, description: first.description }; }
      return toInbox();
    }
    // Ours: replacing this reference would orphan the only durable working copy of its previous activation.
    if (first.worktreeOutcome?.state === "kept" && first.worktreeOutcome.copyId) {
      return { ok: false, code: "unavailable", message: `Subagent ${id} still has unsaved work in copy ${first.worktreeOutcome.copyId}; server startup must recover that copy before it can be woken.` };
    }
    await ctx.refreshAgentTypes?.();
    const type = childTypeOf(preset, ctx.agentTypes);
    if (!type) return { ok: false, code: "unavailable", message: `subagent "${id}" has no agent preset projection for restoration` };
    const childTools = childToolsFor(ctx.declarations, type, first.planMode || ctx.planMode || ctx.readOnly === true);
    if (!childTools.length) return { ok: false, code: "unavailable", message: `agent type "${preset}" leaves the subagent no tools to work with` };
    if (ctx.spend.over()) return { ok: false, code: "turn_budget_reached", message: TURN_BUDGET_REACHED };
    const abort = new AbortController();
    if (!reserve(ctx.projectId, id, abort)) return { ok: false, code: "too_many_subagents", message: TOO_MANY_SUBAGENTS };
    // Read-only if it started so, if Len plans now, or if the waking session is read-only: a scope never widens.
    const scope = first.planMode || ctx.planMode || ctx.readOnly === true;
    // An isolated child wakes in a new copy of the draft as it is now: what it did before already came back (phase 4).
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
    const w = isolates(id, type, scope, first.worktreeBranch ? "worktree" : undefined) ? await makeCopy(id) : undefined;
    if (w === null) {
      await failUnstarted(id, first);
      release(ctx.projectId, id);
      return { ok: false, code: "unavailable", message: WORKTREE_FAILED };
    }
    try { if (w) await io.store.setWorktree?.(id, w); }
    catch (error) { if (w) await discardUnused(id, w, first.description); await failUnstarted(id, first); release(ctx.projectId, id); throw error; }
    // Read again now that it is ours: what a stop kept in its transcript while this message was on its way.
    const row = (await io.store.runOfCurrentConversation(ctx.projectId, id).catch(() => null)) ?? first;
    const transcript = (row.transcript as Message[] | null) ?? [];
    // A run saved before its task was kept in its transcript (phase 1 kept only its own messages, which open with its
    // first answer), or cut before its first save: its task goes first, as it started.
    const head = !row.forked && transcript[0]?.role !== "user" ? preload(type, childMessages(ctx.turnArgs, type, row.prompt)).slice(1) : [];
    const spec: ChildSpec = {
      id,
      description: row.description,
      preset,
      type,
      forked: row.forked,
      planMode: scope,
      messages: [
        { role: "system", content: row.forked ? ctx.lenSystemPrompt : childSystemPromptFor(ctx.lenSystemPrompt, type, SUBAGENT_GUIDANCE) },
        ...head,
        ...transcript,
        ...(w ? [{ role: "user" as const, content: isolationLine(w.branch) }] : []),
        ...texts.map(fromLen),
      ],
      ...(w ? { worktree: w } : {}),
      ...(row.forked
        ? { tools: [...ctx.declarations], allowed: generalPurposeNames(scope) }
        : { tools: childTools }),
      prior: {
        toolUses: row.toolUses,
        durationMs: row.durationMs ?? 0,
        charged: row.chargedCenticredits,
        usage: usageOf(row.usage),
        actions: row.actions as ChildStep[],
      },
    };
    ctx.emit?.({ type: "subagent", id, preset, description: row.description, status: "running", ...(w ? { worktree: { state: "working" as const } } : {}) });
    void run(spec, abort).catch((e: unknown) => log(`[subagents] run=${id} crashed: ${String(e)}`));
    return { ok: true, resumed: true, preset, description: row.description };
  }

  /** Whether `id` is one of Len's children: a run of the project's current conversation. */
  const ofThisConversation = async (id: string) => (await io.store.runsOfCurrentConversation(ctx.projectId)).some((r) => r.id === id);

  /** Phase 4: whether this run works in its own copy — asked by the call or by its type's file, dropped (and logged)
   *  for a child that can't write, without git, or without the copy's parts. */
  function isolates(id: string, type: ChildType, planMode: boolean, asked: "worktree" | undefined): boolean {
    if (!(asked ?? (type.kind === "custom" ? type.type.agent.isolation : null))) return false;
    const why = isReadOnlyFor(type, planMode) ? "read-only" : !gitEnabled() ? "git disabled" : !io.addWorktree || !io.finishWorktree ? "no worktree support" : null;
    if (why) log(`[subagents] run=${id} isolation ignored: ${why}`);
    return why === null;
  }

  /** The copy, or null when it can't be made (the launch is then refused). */
  async function makeCopy(id: string): Promise<AgentWorktree | null> {
    try {
      return await io.addWorktree!({ parentId: ctx.projectId, ownerId: ctx.ownerId, runId: id });
    } catch (e) {
      log(`[subagents] run=${id} its copy could not be made: ${String(e)}`);
      return null;
    }
  }

  const withLine = <M extends Message>(m: M, w: AgentWorktree | null): M => (w ? { ...m, content: `${m.content}\n\n${isolationLine(w.branch)}` } : m);

  async function failUnstarted(id: string, prior?: SubagentRunRow) {
    await io.store.settleRun(id, { status: "error", finalText: prior?.finalText ?? "", diagnostic: WORKTREE_FAILED, transcript: prior?.transcript ?? [], actions: prior?.actions ?? [], usage: prior?.usage ?? NO_USAGE, toolUses: prior?.toolUses ?? 0, durationMs: prior?.durationMs ?? 0, chargedCenticredits: prior?.chargedCenticredits ?? 0 }).catch(e => log(`[subagents] run=${id} saving failed launch: ${String(e)}`));
  }

  async function discardUnused(id: string, w: AgentWorktree, description: string) {
    const session = { ...ctx.sessionBase, projectId: ctx.projectId, userId: ctx.userId, turnId: ctx.turnId, terminalHolderId: id, isSubagent: true, page: null, imageEditsThisTurn: 0, photoSearchesThisTurn: 0, busquedasVaciasSeguidas: 0 } as AgentSession;
    try {
      const result = await io.finishWorktree!({ w, description, session });
      await io.store.setWorktreeOutcome?.(id, result.outcome);
    } catch (e) { log(`[subagents] run=${id} discarding unused copy failed: ${String(e)}`); }
  }

  /** Len's tools a general-purpose child may run: a fork is declared all of Len's (his cached prefix) and gated to these. */
  const generalPurposeNames = (planMode: boolean) => new Set(childToolDeclarations(ctx.declarations, "general-purpose", planMode).map((d) => String(d.name)));

  return {
    refreshTypes: ctx.refreshAgentTypes,
    typeNames: () => ctx.agentTypes.names(),
    async launch(o) {
      await ctx.refreshAgentTypes?.();
      const type = childTypeOf(o.preset, ctx.agentTypes);
      const tools = type ? childToolsFor(ctx.declarations, type, ctx.planMode || ctx.readOnly === true) : [];
      if (!type || !tools.length) return { ok: false, code: "no_tools", message: `agent type "${o.preset}" leaves the subagent no tools to work with` };
      if (ctx.spend.over()) return { ok: false, code: "turn_budget_reached", message: TURN_BUDGET_REACHED };
      const id = io.newId();
      const abort = new AbortController();
      if (!reserve(ctx.projectId, id, abort)) return { ok: false, code: "too_many_subagents", message: TOO_MANY_SUBAGENTS };
      let w: AgentWorktree | null | undefined;
      try {
        await io.store.createRun({ id, projectId: ctx.projectId, chatRowId: ctx.chatRowId, turnId: ctx.turnId, personId: ctx.personId, preset: o.preset, description: o.description, prompt: o.prompt, forked: false, planMode: ctx.planMode || ctx.readOnly === true });
        w = isolates(id, type, ctx.planMode || ctx.readOnly === true, o.isolation) ? await makeCopy(id) : undefined;
        if (w === null) { await failUnstarted(id); release(ctx.projectId, id); return { ok: false, code: "worktree_failed", message: WORKTREE_FAILED }; }
        if (w) await io.store.setWorktree?.(id, w);
      } catch (e) {
        if (w) await discardUnused(id, w, o.description);
        await failUnstarted(id);
        release(ctx.projectId, id);
        throw e;
      }
      ctx.emit?.({ type: "subagent", id, preset: o.preset, description: o.description, status: "running", ...(w ? { worktree: { state: "working" as const } } : {}) });
      const spec: ChildSpec = {
        id,
        description: o.description,
        preset: o.preset,
        type,
        forked: false,
        planMode: ctx.planMode,
        messages: preload(type, childMessages(ctx.turnArgs, type, o.prompt)).map((m, i, all) =>
          i === all.length - 1 ? withLine(o.fromSkill ? { ...m, runningSkill: o.fromSkill } : m, w ?? null) : m,
        ),
        // Delivered to its caller (DeepSeek's `delivery: "caller"`): it reports only through its output, so it has no
        // `send_message` — a message to Len would wake him with a turn nobody asked for.
        tools: [
          ...(o.delivery === "caller" ? tools.filter((t) => (t as { name?: unknown }).name !== SEND_MESSAGE_TOOL) : tools),
          ...(o.outputSchema ? [structuredOutputDeclaration(o.outputSchema)] : []),
        ],
        prior: NOTHING_YET,
        ...(w ? { worktree: w } : {}),
        ...(o.outputSchema ? { outputSchema: o.outputSchema } : {}),
        ...(o.delivery ? { delivery: o.delivery } : {}),
        ...(o.onSettled ? { onSettled: o.onSettled } : {}),
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
      const type: ChildType = { kind: "builtin", preset: "general-purpose" };
      let w: AgentWorktree | null | undefined;
      try {
        await io.store.createRun({ id, projectId: ctx.projectId, chatRowId: ctx.chatRowId, turnId: ctx.turnId, personId: ctx.personId, preset: "general-purpose", description: o.description, prompt: o.prompt, forked: true, planMode: ctx.planMode || ctx.readOnly === true });
        w = isolates(id, type, ctx.planMode || ctx.readOnly === true, o.isolation) ? await makeCopy(id) : undefined;
        if (w === null) { await failUnstarted(id); release(ctx.projectId, id); return { ok: false, code: "worktree_failed", message: WORKTREE_FAILED }; }
        if (w) await io.store.setWorktree?.(id, w);
      } catch (e) {
        if (w) await discardUnused(id, w, o.description);
        await failUnstarted(id);
        release(ctx.projectId, id);
        throw e;
      }
      ctx.emit?.({ type: "subagent", id, preset: "general-purpose", description: o.description, status: "running", ...(w ? { worktree: { state: "working" as const } } : {}) });
      const spec: ChildSpec = {
        id,
        description: o.description,
        preset: "general-purpose",
        type,
        forked: true,
        planMode: ctx.planMode,
        messages: [...ctx.forkSeed, withLine({ role: "user", content: withContinuableReturnGuidance(`${o.prompt}\n\n${DELEGATION_SCOPE_STATEMENT}`) }, w ?? null)],
        tools: [...ctx.declarations],
        allowed: generalPurposeNames(ctx.planMode || ctx.readOnly === true),
        prior: NOTHING_YET,
        ...(w ? { worktree: w } : {}),
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
