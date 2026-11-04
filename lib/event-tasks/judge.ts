// THE JUDGE (spec local 2026-11-03-len-que-avisa, §7.5): DeepSeek's read-only event turn. Len's loop, in the task's
// own conversation (never the project chat), with a FIXED tool list: Read, Glob and Grep over the project, the
// source's read and `automation_notify`. No terminal, no writes, no publishing, no web, no MCP, no subagents —
// DeepSeek: a read-only sandbox limits only the disk, not a push or a request. The session is read-only too, as the
// project's owner. Silence is not calling `automation_notify`: there is no end tool and nothing checks how the turn
// ended. Billed to the owner at Len's rate. Like the security review (lib/security-review/real.ts), it runs outside
// any chat turn.
import "server-only";

import type { Message, StreamEvent } from "@/lib/ai-gateway";
import type { ProviderUse } from "@/lib/agent/brain";
import { AUTOMATION_NOTIFY, SOURCE_READ, eventTaskToolDeclarations, eventTaskToolRunner } from "@/lib/agent/event-task-tools";
import { runAgentLoop, type AgentLoopResult } from "@/lib/agent/loop";
import type { AgentSession, ToolOutcome } from "@/lib/agent/tools";

import { candidateMessage, JUDGE_SYSTEM } from "./framing";
import type { AvailableActions } from "./actions/available";
import type { TableColumn } from "./actions/production";
import { seenOfCandidate } from "./actions/seen";
import { CARD_WINDOW_MS, type CardAction } from "./actions/types";
import { validateActions } from "./actions/validate";
import type { EventTaskCardRow, EventTaskRecordRow, EventTaskRow } from "./store";
import type { Candidate } from "./trigger";

export const JUDGE_TOOL_NAMES = ["Read", "Glob", "Grep", SOURCE_READ, AUTOMATION_NOTIFY] as const;
const READ_TOOLS = new Set<string>(["Read", "Glob", "Grep"]);
const ALLOWED = new Set<string>(JUDGE_TOOL_NAMES);
const NOT_GIVEN = "This task's judge can only read and notify.";
/** Model calls before it must answer, like the security review's subagents. */
const MAX_STEPS = 6;
const ANSWER_NOW = "You have used the reading budget for this change. Do not call any more tools except automation_notify: decide now.";
/** The task's own conversation keeps its last messages, cut at a candidate. */
const KEEP_MESSAGES = 40;
/** Len's answer on a card it looked at again: a line or two, plain. */
const ANSWER_MAX = 400;

/** The judge's last words as a card line: no markdown, one paragraph, cut at ANSWER_MAX. */
function asAnswer(text: string): string | null {
  const plain = text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
  if (!plain) return null;
  return plain.length <= ANSWER_MAX ? plain : `${plain.slice(0, ANSWER_MAX - 1).trimEnd()}…`;
}

export interface JudgeDeps {
  now(): Date;
  ownerOf(projectId: string): Promise<string>;
  /** Read, Glob and Grep, as Len's catalog declares them. */
  readDeclarations(): Record<string, unknown>[];
  brain(tools: Record<string, unknown>[]): {
    openStream(m: Message[]): AsyncIterable<StreamEvent>;
    closeOut(m: Message[]): AsyncIterable<StreamEvent>;
    /** What each provider it called spent: the ledger's real cost. */
    providersUsed(): readonly ProviderUse[];
  };
  runReadTool(session: AgentSession, name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  readSource(task: EventTaskRow, keys: readonly string[], match: readonly { field: string; value: string }[], ownerId: string): Promise<unknown>;
  /** What this task's card may propose (lib/event-tasks/actions/available.ts). */
  available(task: EventTaskRow, ownerId: string): Promise<AvailableActions>;
  /** The watched table's columns, read-only; null without one. */
  tableInfo(task: EventTaskRow): Promise<{ readonly columns: readonly TableColumn[] } | null>;
  readRow(task: EventTaskRow, key: string): Promise<Record<string, unknown> | null>;
  castCheck(task: EventTaskRow, column: string, value: string): Promise<string | null>;
  createCard(o: { task: EventTaskRow; recordId: string; title: string; summary: string; actions: readonly CardAction[]; subjectKey: string }): Promise<EventTaskCardRow>;
  decisionsSince(taskId: string, since: Date): Promise<EventTaskCardRow[]>;
  /** The task's cards still waiting for the owner: the judge doesn't repeat one. */
  pendingCards(taskId: string): Promise<EventTaskCardRow[]>;
  saveTranscript(taskId: string, transcript: unknown[], at: Date): Promise<void>;
  markJudged(recordId: string, notified: boolean): Promise<void>;
  /** The record's earlier card that asked to look again hears what the judge found (./cards.ts). */
  answerLookAgain(recordId: string, answer: string): Promise<void>;
  charge(c: { ownerId: string; projectId: string; actorId: string; refId: string; usage: AgentLoopResult["usage"]; uses: readonly JudgeUse[] }): Promise<void>;
  runLoop?: typeof runAgentLoop;
}

/** One provider's spend in a judging turn, as the ledger takes it. */
export interface JudgeUse {
  readonly provider: ProviderUse["provider"];
  readonly model: string;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
}

/** The kept conversation: its last messages, starting at a candidate so no tool result is left without its call. */
function kept(transcript: readonly Message[]): Message[] {
  if (transcript.length <= KEEP_MESSAGES) return [...transcript];
  for (let i = transcript.length - KEEP_MESSAGES; i < transcript.length; i++) {
    const m = transcript[i]!;
    if (m.role === "user" && !m.functionResponses?.length) return transcript.slice(i);
  }
  return [];
}

export async function judgeCandidate(record: EventTaskRecordRow, task: EventTaskRow, deps?: JudgeDeps): Promise<{ notified: boolean }> {
  const d = deps ?? (await defaultJudgeDeps());
  let notified = false;
  try {
    const ownerId = await d.ownerOf(task.projectId);
    const session: AgentSession = {
      projectId: task.projectId,
      userId: ownerId,
      readOnly: true,
      page: null,
      ownerEmail: null,
      imageEditsThisTurn: 0,
      photoSearchesThisTurn: 0,
      busquedasVaciasSeguidas: 0,
      leidos: new Map(),
    };
    // What its card may propose (spec local 2026-11-04-hazlo, §7.1): the source's actions, the watched table's columns.
    const available = await d.available(task, ownerId);
    const channels = available.replyChannels;
    const params = task.params as { table?: string; created_column?: string };
    const keyColumn = (task.state as { key_column?: string } | null)?.key_column ?? null;
    const info = available.dataChange && params.table ? await d.tableInfo(task) : null;
    const editable = info ? info.columns.map((c) => c.name).filter((n) => n !== keyColumn && n !== params.created_column) : [];
    const eventTools = eventTaskToolDeclarations({ dataChange: info !== null, replyChannels: channels, ...(info && params.table ? { table: params.table, columns: editable } : {}) });
    const tools = [...d.readDeclarations().filter((t) => READ_TOOLS.has(String(t.name))), ...eventTools];
    const runEventTool = eventTaskToolRunner({
      notify: async (c) => ({ cardId: (await d.createCard({ task, recordId: record.id, title: c.title, summary: c.summary, actions: c.actions, subjectKey: c.subjectKey })).id }),
      readSource: (keys, match) => d.readSource(task, keys, match, ownerId),
      keyColumn,
      replyChannels: channels,
      seen: seenOfCandidate(record.candidate, keyColumn, channels),
      validate: (input, seen) =>
        validateActions(input, {
          available: { project: true, dataChange: info !== null, replyChannels: channels },
          ...(params.table ? { table: params.table } : {}),
          ...(keyColumn ? { keyColumn } : {}),
          ...(params.created_column ? { createdColumn: params.created_column } : {}),
          ...(info ? { columns: info.columns } : {}),
          seenKeys: seen.keys,
          seenAddresses: seen.addresses,
          seenConversations: seen.conversations,
          seenThreads: seen.threads,
          recordId: record.id,
          readRow: (key) => d.readRow(task, key),
          castCheck: (column, value) => d.castCheck(task, column, value),
        }),
    });
    const [decisions, pending] = await Promise.all([d.decisionsSince(task.id, task.lastJudgedAt ?? task.createdAt), d.pendingCards(task.id)]);
    const prior = kept((task.transcript ?? []) as Message[]);
    const ask: Message = { role: "user", content: candidateMessage({ task, candidate: record.candidate as unknown as Candidate, decisions, pending, note: record.note }) };
    const brains = [d.brain(tools)];
    const brain = brains[0]!;
    // Past the reading budget, ONE more call that can only notify: the verdict is a tool call, so a call without
    // tools (closeOut) could never notify (final review I1). After it, closeOut ends the turn.
    const notifyOnly = eventTools.filter((t) => t.name === AUTOMATION_NOTIFY);
    let steps = 0;
    const result = await (d.runLoop ?? runAgentLoop)({
      messages: [{ role: "system", content: JUDGE_SYSTEM }, ...prior, ask],
      tools,
      openStream: (messages) => {
        steps++;
        if (steps <= MAX_STEPS) return brain.openStream(messages);
        if (steps === MAX_STEPS + 1) {
          const last = d.brain(notifyOnly);
          brains.push(last);
          return last.openStream([...messages, { role: "user", content: ANSWER_NOW }]);
        }
        return brain.closeOut(messages);
      },
      closeOut: brain.closeOut,
      runTool: async (name, args) => {
        // The loop refuses what it was not declared; this is the second gate of a guarantee that can't fail.
        if (!ALLOWED.has(name)) return { response: { ok: false, error: NOT_GIVEN } };
        if (READ_TOOLS.has(name)) return d.runReadTool(session, name, args);
        return runEventTool(name, args);
      },
      emit: () => {},
      unattended: true,
    });
    notified = runEventTool.notified();
    // Put back by the owner (requeueRecord moves `lastAt`) and no new card: the card that asked hears the judge.
    const answer = asAnswer(result.finalText ?? "");
    if (!notified && answer && record.lastAt.getTime() > record.firstAt.getTime()) await d.answerLookAgain(record.id, answer);
    await d.saveTranscript(task.id, [...prior, ask, ...(result.transcripcion ?? [])], d.now());
    // Each provider's tokens: the ledger prices them, so a judging turn has its real cost like a chat turn.
    const uses = brains.flatMap((b) =>
      b.providersUsed().map((u) => ({ provider: u.provider, model: u.model, inputTokens: u.inputTokens, cachedTokens: u.cachedTokens, outputTokens: u.outputTokens, reasoningTokens: u.thinkingTokens })),
    );
    await d.charge({ ownerId, projectId: task.projectId, actorId: task.createdBy, refId: record.id, usage: result.usage, uses });
    return { notified };
  } finally {
    await d.markJudged(record.id, notified);
  }
}

/** The real parts, as the security review wires them (lib/security-review/real.ts). */
async function defaultJudgeDeps(): Promise<JudgeDeps> {
  const [{ createAgentBrain }, { buildFunctionDeclarations }, { streamWithRetry }, { declaracionesDeSoloLectura }, tools, { creditsForUsage, chargeCredits }, policy, store, cards, { sourceOf }, { db, schema }, { eq }] =
    await Promise.all([
      import("@/lib/agent/brain"),
      import("@/lib/agent/catalog"),
      import("@/lib/agent/retry"),
      import("@/lib/agent/subagente"),
      import("@/lib/agent/tools"),
      import("@/lib/credits"),
      import("@/lib/generation/model-policy"),
      import("./store"),
      import("./cards"),
      import("./sources"),
      import("@/lib/db"),
      import("drizzle-orm"),
    ]);
  const [available, production] = await Promise.all([import("./actions/available"), import("./actions/production")]);
  const deps = tools.realDeps();
  return {
    now: () => new Date(),
    ownerOf: async (projectId) => {
      const [row] = await db.select({ userId: schema.projects.userId }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
      if (!row) throw new Error(`no project ${projectId}`);
      return row.userId;
    },
    readDeclarations: () => declaracionesDeSoloLectura(buildFunctionDeclarations(process.env, {}, "len", null)),
    brain: (declared) => {
      const brain = createAgentBrain({ tools: declared, requestId: `event-task:${declared.length}`, esfuerzoDelTurno: "high" });
      return {
        openStream: (m) => streamWithRetry(() => brain.openStream(m), {}),
        closeOut: (m) => streamWithRetry(() => brain.closeOut(m), {}),
        providersUsed: () => brain.providersUsed(),
      };
    },
    runReadTool: (session, name, args) => tools.runAgentTool(session, deps, name, args),
    readSource: (task, keys, match, ownerId) =>
      sourceOf(task.source).read(task.projectId, task.params, { keys, state: task.state, match, ctx: { timeZone: task.timeZone, now: new Date(), ownerId } }),
    available: (task, ownerId) => available.availableActions(task, ownerId, available.defaultAvailableDeps()),
    tableInfo: (task) => production.tableColumns(task.projectId, (task.params as { table: string }).table),
    readRow: (task, key) => production.readRow(task.projectId, (task.params as { table: string }).table, (task.state as { key_column: string }).key_column, key),
    castCheck: (task, column, value) => production.castCheck(task.projectId, (task.params as { table: string }).table, column, value),
    createCard: (o) => cards.createCard(o),
    decisionsSince: cards.decisionsSince,
    pendingCards: (taskId) => cards.pendingCardsOfTask(taskId, new Date(Date.now() - CARD_WINDOW_MS)),
    saveTranscript: store.saveTranscript,
    markJudged: store.markJudged,
    answerLookAgain: cards.answerLookAgain,
    charge: async (c) => {
      const rate = policy.creditRateForRole(policy.roleForOperation("event_task_judge"));
      const centicredits = creditsForUsage(c.usage.inputTokens, c.usage.outputTokens, rate, c.usage.cachedTokens);
      const at = new Date();
      await chargeCredits(c.ownerId, centicredits, {
        surface: "event_task",
        outcome: "ok",
        projectId: c.projectId,
        actorId: c.actorId,
        refId: c.refId,
        listCenticredits: centicredits,
        uses: c.uses.map((u) => ({ ...u, at })),
      });
    },
  };
}
