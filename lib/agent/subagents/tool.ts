// THE SUBAGENT TOOLS (spec local 2026-11-01-subagentes-de-len, §4.1 and §5): DeepSeek Harness's
// (`packages/subagent/tool-subagent/src/index.ts` and `packages/subagent/tool-subagent-control/src/` @ ce7073d,
// MIT, LICENSES/deepseek-harness.MIT.txt) for continuable children: `subagent`, `subagent_fork`,
// `send_message`, `interrupt_agent` and `list_agents` — names, descriptions, parameters and answers word for
// word. Always in the background, as DeepSeek's (Jesús, 01/11). `agent_preset` is DeepSeek's parameter; what
// it picks are Claude Code's three types and OpenLen's two (phase 4). The line per type and the two closing
// sentences are ours.
//
// The tools only validate and hand over: the launcher (`deps.subagents`, lib/agent/subagents/run.ts)
// builds, runs, wakes and stops the children, and their notices reach Len later.
//
// Cache effect: the declaration changes when the project's or speaker's custom types change; without
// custom types it is byte for byte the fixed declaration, which lists Claude Code's three types and
// OpenLen's two. Answers are appended.

import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";

import { BUNDLED_AGENT_TYPES } from "./bundled-types";
import { INTERRUPT_AGENT_TOOL, LIST_AGENTS_TOOL, SEND_MESSAGE_TOOL, SUBAGENT_FORK_TOOL, SUBAGENT_TOOL } from "./enabled";
import { LEN_AGENT_ID, startedLine } from "./notice";
import { SUBAGENT_PRESETS } from "./presets";
import type { AgentTypeSet } from "./agent-registry";

/** DeepSeek's `tool:subagent` system-prompt section, with `subagent` and `subagent_fork` visible. */
export const SUBAGENT_GUIDANCE =
  "Start independent delegations with `subagent` or `subagent_fork` together in one assistant message and continue useful work while they run. When only waiting for their results remains, end your turn instead of sleeping or polling; the next result starts a new turn.";

/** DeepSeek's sentences for a backend whose children accept `send_message`. */
const CONTINUABLE =
  "This tool starts an independently managed subagent and immediately returns its id. The runtime notifies you when it finishes. The child reports results with `send_message`; use `send_message` to steer it while running or continue its conversation after it finishes.";
/** Ours: what Claude Code says that DeepSeek doesn't. */
const NOT_SHOWN = "Its final message is not shown to the user: tell them what matters. Never report or guess a subagent's result before its notice arrives.";
const SHORT_DESCRIPTION = "A short (3-5 word) description of the delegated task, for display.";

const DESCRIPTION = [
  // DeepSeek's `providerWording(false)`.
  "Delegate a self-contained task to a subagent (a separate agent that works in its own context) to offload focused, independent work — research, a scoped implementation, an analysis — so it does not consume this conversation's context. The subagent returns its result, not its intermediate steps.",
  CONTINUABLE,
  // Ours: the three types (Claude Code's).
  "Types (agent_preset): general-purpose (the default) works on the task with your tools and can change files; Explore is a fast, read-only search of the project that answers with paths and lines — say how far to look: quick, medium or very thorough; Plan is read-only and answers with a step-by-step plan and the files it depends on.",
  // Ours: OpenLen's own types (bundled-types.ts), always offered.
  `OpenLen's types: ${BUNDLED_AGENT_TYPES.map((a) => `${a.name}: ${a.description}`).join("; ")}`,
  NOT_SHOWN,
].join(" ");

export const SUBAGENT_DECLARATION: Record<string, unknown> = {
  name: SUBAGENT_TOOL,
  description: DESCRIPTION,
  parameters: {
    type: "OBJECT",
    properties: {
      description: { type: "STRING", description: SHORT_DESCRIPTION },
      prompt: {
        type: "STRING",
        description: "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs.",
      },
      agent_preset: { type: "STRING", enum: [...SUBAGENT_PRESETS, ...BUNDLED_AGENT_TYPES.map((a) => a.name)], description: "The type of subagent; general-purpose when omitted." },
    },
    required: ["description", "prompt"],
  },
};

/** Ours, after Claude Code's `isolation` parameter (phase 4): offered when git is on. */
const ISOLATION_PARAMETER = {
  type: "STRING",
  enum: ["worktree"],
  description:
    '"worktree": the subagent works in its own copy of the project, on its own git branch. What it changes in the project\'s folder comes back into your files when it finishes; if it changes nothing, the copy is removed; what it leaves outside the folder (/tmp) is lost. Use it when several subagents write at the same time.',
};

type Declaration = Record<string, unknown> & { parameters: { properties: Record<string, Record<string, unknown>> } };

const withIsolation = (d: Record<string, unknown>, isolation: boolean): Record<string, unknown> => {
  if (!isolation) return d;
  const parameters = (d as Declaration).parameters;
  return { ...d, parameters: { ...parameters, properties: { ...parameters.properties, isolation: ISOLATION_PARAMETER } } };
};

/** Ours: custom types extend DeepSeek's preset enum; keep the fixed declaration unchanged. */
export function subagentDeclaration(types: AgentTypeSet, opts: { isolation: boolean } = { isolation: false }): Record<string, unknown> {
  if (!types.custom.length) return withIsolation(SUBAGENT_DECLARATION, opts.isolation);
  const parameters = (SUBAGENT_DECLARATION as Declaration).parameters;
  const summaries = types.custom.map(({ agent, covers }) => `${agent.name}${covers ? ` (yours, over the project's ${agent.name})` : ""}: ${agent.description.slice(0, 500)}`);
  return withIsolation({ ...SUBAGENT_DECLARATION, description: `${DESCRIPTION} Custom types: ${summaries.join("; ")}`, parameters: {
    ...parameters, properties: { ...parameters.properties, agent_preset: { ...parameters.properties.agent_preset, enum: types.names() } },
  } }, opts.isolation);
}

/** `subagent_fork`, with `isolation` when git is on (phase 4). */
export function subagentForkDeclaration(opts: { isolation: boolean } = { isolation: false }): Record<string, unknown> {
  return withIsolation(SUBAGENT_FORK_DECLARATION, opts.isolation);
}

/** DeepSeek's `providerWording(true)`: a child seeded with the conversation's completed turns. */
export const SUBAGENT_FORK_DECLARATION: Record<string, unknown> = {
  name: SUBAGENT_FORK_TOOL,
  description: [
    "Delegate a task to a subagent that inherits this conversation: a child agent seeded with all completed turns so far (it does not see the current in-flight turn). Use this when the subtask builds on this conversation's context — a follow-up analysis, a review, a continuation — without consuming this conversation's context for the work itself. You receive its result, not its intermediate steps.",
    CONTINUABLE,
    NOT_SHOWN,
  ].join(" "),
  parameters: {
    type: "OBJECT",
    properties: {
      description: { type: "STRING", description: SHORT_DESCRIPTION },
      prompt: {
        type: "STRING",
        description: "The task for the subagent. It already sees this conversation's completed turns, so build on them freely and state only what is new.",
      },
    },
    required: ["description", "prompt"],
  },
};

export const SEND_MESSAGE_DECLARATION: Record<string, unknown> = {
  name: SEND_MESSAGE_TOOL,
  description:
    "Send a message to an agent. A working agent receives it at its next step; an idle agent starts a new turn with it. Returns delivery confirmation, not the agent's answer.",
  parameters: {
    type: "OBJECT",
    properties: {
      agent_id: {
        type: "STRING",
        description: "The agent id of your direct continuable child, or your direct parent when you are a resident continuable child.",
      },
      message: { type: "STRING", description: "The message to deliver to the agent." },
    },
    required: ["agent_id", "message"],
  },
};

export const INTERRUPT_AGENT_DECLARATION: Record<string, unknown> = {
  name: INTERRUPT_AGENT_TOOL,
  description:
    "Ask a subagent to stop its current work. This call returns without waiting for it to stop. You can continue a local direct child's conversation later with send_message. External executions stop permanently and cannot receive follow-ups. Subagents it started will keep running.",
  parameters: {
    type: "OBJECT",
    properties: {
      agent_id: { type: "STRING", description: "The id of an agent created under you: your direct child or a deeper descendant." },
    },
    required: ["agent_id"],
  },
};

export const LIST_AGENTS_DECLARATION: Record<string, unknown> = {
  name: LIST_AGENTS_TOOL,
  description:
    "List subagents you started, with their ids, labels, and status. running means it is working; inactive means it is not currently working. You will be notified when a subagent finishes; there is no need to keep checking its status. Use send_message to continue the conversation.",
  parameters: {
    type: "OBJECT",
    properties: {
      scope: {
        type: "STRING",
        enum: ["children", "descendants"],
        description:
          "children (default) lists direct children, which accept send_message in any status. descendants lists the whole tree below you with each entry's parent session id and depth; entries deeper than 1 accept only interrupt_agent.",
      },
    },
  },
};

/** DeepSeek's answers. */
export function messageDeliveredLine(id: string): string {
  return `message delivered to agent ${id}`;
}

export function interruptRequestedLine(id: string): string {
  return `interrupt requested for agent ${id}`;
}

export type ListAgentsScope = "children" | "descendants";

/** DeepSeek's `list_agents` rendering. Depth is 1, so every child of Len is at depth 1 under `len`. */
export function listAgentsText(entries: readonly { id: string; label: string; status: "running" | "inactive" }[], scope: ListAgentsScope): string {
  if (entries.length === 0) return "(no subagents)";
  const at = scope === "descendants" ? ` parent=${LEN_AGENT_ID} depth=1` : "";
  return entries.map((e) => `${e.id} [${e.status}]${at} — ${e.label}`).join("\n");
}

/** DeepSeek's errors: a target that isn't Len's child (or doesn't exist); one of Len's children addressed by a child
 *  (its parent is Len, not the sender); and a parent that is gone (the conversation was archived). */
export function unavailableError(id: string): string {
  return `subagent "${id}" is unavailable`;
}

export function belongsToAnotherParentError(id: string): string {
  return `subagent "${id}" belongs to another parent session`;
}

export function parentGoneError(): string {
  return "direct parent is not live; the message was not delivered";
}

export type LaunchRefusal = "too_many_subagents" | "turn_budget_reached" | "subagents_disabled" | "no_tools" | "worktree_failed";

/** What `send` answers: delivered into a running child's inbox (`resumed: false`), or it woke from its transcript. */
export type SendResult =
  | { ok: true; resumed: boolean; preset: string; description: string }
  | { ok: false; code: "unavailable" | "too_many_subagents" | "turn_budget_reached"; message: string };

export interface SubagentsDeps {
  /** Re-read project/speaker types after their files changed, before validating a launch. */
  refreshTypes?(): Promise<void>;
  typeNames(): readonly string[];
  launch(o: { description: string; prompt: string; preset: string; fromSkill?: string; isolation?: "worktree" }): Promise<{ ok: true; id: string } | { ok: false; code: LaunchRefusal; message: string }>;
  /** `subagent_fork`: a general-purpose child seeded with Len's completed turns (phase 2). */
  fork(o: { description: string; prompt: string; isolation?: "worktree" }): Promise<{ ok: true; id: string } | { ok: false; code: LaunchRefusal; message: string }>;
  /** Len's `send_message` to one of his children (phase 2). */
  send(o: { id: string; message: string }): Promise<SendResult>;
  /** `interrupt_agent`: stops a working child of the current conversation; false when there was none. */
  interrupt(id: string): Promise<boolean>;
  /** `list_agents`: the current conversation's children. */
  list(): Promise<{ id: string; label: string; status: "running" | "inactive" }[]>;
}

const invalid = (message: string): ToolOutcome => ({ response: { ok: false, error: "invalid_arguments", message } });

/** `isolation`, when given, can only be "worktree"; `false` when it is anything else. */
function isolationOf(args: Record<string, unknown>): { isolation?: "worktree" } | false {
  if (args.isolation === undefined) return {};
  return args.isolation === "worktree" ? { isolation: "worktree" } : false;
}
const BAD_ISOLATION = "isolation must be worktree.";

export async function toolSubagent(_session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const description = typeof args.description === "string" ? args.description.trim() : "";
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!description) return invalid("description is required: a short (3-5 word) description of the task.");
  if (!prompt) return invalid("prompt is required: the complete, self-contained task.");
  const isolation = isolationOf(args);
  if (!isolation) return invalid(BAD_ISOLATION);
  const preset = args.agent_preset ?? "general-purpose";
  await deps.subagents?.refreshTypes?.();
  const names = deps.subagents?.typeNames?.() ?? SUBAGENT_PRESETS;
  if (typeof preset !== "string" || !names.includes(preset)) {
    return invalid(`agent_preset must be one of: ${names.join(", ")}`);
  }
  const type = preset;
  if (!deps.subagents) return { response: { ok: false, error: "subagents_disabled", message: "Subagents are not available in this session." } };
  const r = await deps.subagents.launch({ description, prompt, preset: type, ...isolation });
  if (!r.ok) return { response: { ok: false, error: r.code, message: r.message } };
  return {
    response: { ok: true, tool_result: startedLine(r.id) },
    action: { tool: SUBAGENT_TOOL, ok: true, summary: description },
    subagent: { id: r.id, preset: type },
  };
}

const disabled = (): ToolOutcome => ({ response: { ok: false, error: "subagents_disabled", message: "Subagents are not available in this session." } });
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** `subagent_fork`: always general-purpose; its task builds on what Len and the person already said. */
export async function toolSubagentFork(_session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const description = text(args.description);
  const prompt = text(args.prompt);
  if (!description) return invalid("description is required: a short (3-5 word) description of the task.");
  if (!prompt) return invalid("prompt is required: the task for the subagent.");
  const isolation = isolationOf(args);
  if (!isolation) return invalid(BAD_ISOLATION);
  if (!deps.subagents) return disabled();
  const r = await deps.subagents.fork({ description, prompt, ...isolation });
  if (!r.ok) return { response: { ok: false, error: r.code, message: r.message } };
  return {
    response: { ok: true, tool_result: startedLine(r.id) },
    action: { tool: SUBAGENT_FORK_TOOL, ok: true, summary: description },
    subagent: { id: r.id, preset: "general-purpose" },
  };
}

/** Len's `send_message`: a working child reads it at its next step; an idle one wakes with it (its card shows
 *  in this turn). A child's own `send_message` never comes here: its launcher answers it. */
export async function toolSendMessage(_session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const id = text(args.agent_id);
  const message = text(args.message);
  if (!id) return invalid("agent_id is required.");
  if (!message) return invalid("message is required.");
  if (!deps.subagents) return disabled();
  const r = await deps.subagents.send({ id, message });
  if (!r.ok) return { response: { ok: false, error: r.code, message: r.message } };
  return {
    response: { ok: true, tool_result: messageDeliveredLine(id) },
    ...(r.resumed ? { action: { tool: SEND_MESSAGE_TOOL, ok: true, summary: r.description }, subagent: { id, preset: r.preset } } : {}),
  };
}

/** `interrupt_agent`: like the ■ of its card; it answers at once, as DeepSeek's, whether or not it was working. */
export async function toolInterruptAgent(_session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const id = text(args.agent_id);
  if (!id) return invalid("agent_id is required.");
  if (!deps.subagents) return disabled();
  await deps.subagents.interrupt(id);
  return { response: { ok: true, tool_result: interruptRequestedLine(id) } };
}

export async function toolListAgents(_session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const scope = args.scope ?? "children";
  if (scope !== "children" && scope !== "descendants") return invalid("scope must be children or descendants.");
  if (!deps.subagents) return disabled();
  return { response: { ok: true, tool_result: listAgentsText(await deps.subagents.list(), scope) } };
}
