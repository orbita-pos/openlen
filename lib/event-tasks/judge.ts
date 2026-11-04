// THE JUDGE (spec local 2026-11-03-len-que-avisa, §7.5): DeepSeek's read-only event turn. Len's loop, in the task's
// own conversation (never the project chat), with a FIXED tool list: Read, Glob and Grep over the project, the
// source's read and `automation_notify`. No terminal, no writes, no publishing, no web, no MCP, no subagents —
// DeepSeek: a read-only sandbox limits only the disk, not a push or a request. The session is read-only too, as the
// project's owner. Silence is not calling `automation_notify`: there is no end tool and nothing checks how the turn
// ended. Billed to the owner at Len's rate. Like the security review (lib/security-review/real.ts), it runs outside
// any chat turn.
import "server-only";

import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { AUTOMATION_NOTIFY, EVENT_TASK_TOOL_DECLARATIONS, SOURCE_READ, eventTaskToolRunner } from "@/lib/agent/event-task-tools";
import { runAgentLoop, type AgentLoopResult } from "@/lib/agent/loop";
import type { AgentSession, ToolOutcome } from "@/lib/agent/tools";

import { candidateMessage, JUDGE_SYSTEM } from "./framing";
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

export interface JudgeDeps {
  now(): Date;
  ownerOf(projectId: string): Promise<string>;
  /** Read, Glob and Grep, as Len's catalog declares them. */
  readDeclarations(): Record<string, unknown>[];
  brain(tools: Record<string, unknown>[]): { openStream(m: Message[]): AsyncIterable<StreamEvent>; closeOut(m: Message[]): AsyncIterable<StreamEvent> };
  runReadTool(session: AgentSession, name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  readSource(task: EventTaskRow, keys: readonly string[], match: readonly { field: string; value: string }[]): Promise<unknown>;
  createCard(o: { task: EventTaskRow; recordId: string; title: string; summary: string; proposedAction: string }): Promise<EventTaskCardRow>;
  decisionsSince(taskId: string, since: Date): Promise<EventTaskCardRow[]>;
  saveTranscript(taskId: string, transcript: unknown[], at: Date): Promise<void>;
  markJudged(recordId: string, notified: boolean): Promise<void>;
  charge(c: { ownerId: string; projectId: string; actorId: string; refId: string; usage: AgentLoopResult["usage"] }): Promise<void>;
  runLoop?: typeof runAgentLoop;
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
    const tools = [...d.readDeclarations().filter((t) => READ_TOOLS.has(String(t.name))), ...EVENT_TASK_TOOL_DECLARATIONS];
    const runEventTool = eventTaskToolRunner({
      notify: async (c) => ({ cardId: (await d.createCard({ task, recordId: record.id, ...c })).id }),
      readSource: (keys, match) => d.readSource(task, keys, match),
    });
    const decisions = await d.decisionsSince(task.id, task.lastJudgedAt ?? task.createdAt);
    const prior = kept((task.transcript ?? []) as Message[]);
    const ask: Message = { role: "user", content: candidateMessage({ task, candidate: record.candidate as unknown as Candidate, decisions }) };
    const brain = d.brain(tools);
    // Past the reading budget, ONE more call that can only notify: the verdict is a tool call, so a call without
    // tools (closeOut) could never notify (final review I1). After it, closeOut ends the turn.
    const notifyOnly = EVENT_TASK_TOOL_DECLARATIONS.filter((t) => t.name === AUTOMATION_NOTIFY);
    let steps = 0;
    const result = await (d.runLoop ?? runAgentLoop)({
      messages: [{ role: "system", content: JUDGE_SYSTEM }, ...prior, ask],
      tools,
      openStream: (messages) => {
        steps++;
        if (steps <= MAX_STEPS) return brain.openStream(messages);
        if (steps === MAX_STEPS + 1) return d.brain(notifyOnly).openStream([...messages, { role: "user", content: ANSWER_NOW }]);
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
    });
    notified = runEventTool.notified();
    await d.saveTranscript(task.id, [...prior, ask, ...(result.transcripcion ?? [])], d.now());
    await d.charge({ ownerId, projectId: task.projectId, actorId: task.createdBy, refId: record.id, usage: result.usage });
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
      };
    },
    runReadTool: (session, name, args) => tools.runAgentTool(session, deps, name, args),
    readSource: (task, keys, match) => sourceOf(task.source).read(task.projectId, task.params, { keys, state: task.state, match }),
    createCard: (o) => cards.createCard(o),
    decisionsSince: cards.decisionsSince,
    saveTranscript: store.saveTranscript,
    markJudged: store.markJudged,
    charge: async (c) => {
      const rate = policy.creditRateForRole(policy.roleForOperation("event_task_judge"));
      const centicredits = creditsForUsage(c.usage.inputTokens, c.usage.outputTokens, rate, c.usage.cachedTokens);
      await chargeCredits(c.ownerId, centicredits, { surface: "event_task", outcome: "ok", projectId: c.projectId, actorId: c.actorId, refId: c.refId, listCenticredits: centicredits });
    },
  };
}
