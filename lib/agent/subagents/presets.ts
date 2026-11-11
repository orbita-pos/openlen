// THE THREE SUBAGENT TYPES (spec local 2026-11-01-subagentes-de-len, §4.2 and §4.3): Claude Code's
// `general-purpose`, `Explore` and `Plan`. Their sections are ours, written from the facts of Claude
// Code's definitions (2.1.309: `Explore` and `Plan` read only and go without CLAUDE.md; `Plan` returns a
// plan and its critical files; `general-purpose` does the work itself), never from Anthropic's text.
// The scope statement is DeepSeek Harness's, word for word (`packages/subagent/subagent/README.md`,
// «Child delegation-scope statement» @ ce7073d, MIT, LICENSES/deepseek-harness.MIT.txt).
//
// Which tools a child gets follows Claude Code's rule (2.1.309, the filter every subagent goes through):
// out go the ones that talk to the user or change the session. The child's only way to the user is Len.
//
// Cache effect: the child's system prompt is Len's (the same prefix up to the line taken out) plus its
// type and the scope statement at the end; Len's own prompt does not change.

import { ASK_USER_QUESTION, CONNECT_EMAIL_DOMAIN, REQUEST_SECRETS } from "@/lib/agent/ask-user-question";
import { CONNECT_SHOPIFY_STORE } from "@/lib/agent/connect-shopify-store";
import { CONVERTIR_EN_APP } from "@/lib/agent/convertir-en-app";
import { SET_FORM_AUTO_REPLY } from "@/lib/agent/form-auto-reply";
import { CREATE_GOAL, GET_GOAL, UPDATE_GOAL } from "@/lib/agent/goal-tools";
import { ENTER_PLAN_MODE, EXIT_PLAN_MODE } from "@/lib/agent/plan-mode";
import { SCHEDULE_TOOL_NAMES } from "@/lib/agent/schedule-tools";
import { PRESENT_TOOL } from "@/lib/agent/skills/present";
import { SHOW_WIDGET } from "@/lib/agent/visuals/widget";
import { ARTIFACT_TOOLS } from "@/lib/artifacts/tools";
import { PROPOSE_ACTION } from "@/lib/tools/cards/types";
import { CREATE_ASSISTANT } from "@/lib/assistants/create-tool";

import { INTERRUPT_AGENT_TOOL, LIST_AGENTS_TOOL, SUBAGENT_FORK_TOOL, SUBAGENT_TOOL } from "./enabled";
import type { AgentTypeSet, ResolvedAgentType } from "./agent-registry";

export type SubagentPreset = "general-purpose" | "Explore" | "Plan";

export const SUBAGENT_PRESETS: readonly SubagentPreset[] = ["general-purpose", "Explore", "Plan"];

/**
 * Out for every child: they talk to the user (a question, a card, a delivered file, a widget), change the
 * session (plan mode, the goal, scheduled tasks, undoing Len's turn) or start, stop or list children (depth 1).
 * `send_message` stays: a child reports to Len with it (phase 2).
 *
 * What stays, and why: the files (Read, Grep, Glob, Edit, Write) and `bash`, the work itself; `skill` and
 * `read_me`, which load instructions into the child's own conversation; `view_page` and `use_page`, to look
 * at what it did; `find_photo`, `edit_image`, `toggle_module`, `convert_to_app` and `draft_reply`, which
 * change the project like an Edit does (the owner still approves a draft); the web and image searches;
 * visits, submissions, messages and the session searches, which only read; `todo_write`, its own progress
 * list (Claude Code gives its subagents TodoWrite); and the artifact tools, which work on the project.
 */
const OUT_FOR_EVERY_CHILD: ReadonlySet<string> = new Set([
  "publish",
  ASK_USER_QUESTION,
  REQUEST_SECRETS,
  CONNECT_EMAIL_DOMAIN,
  SET_FORM_AUTO_REPLY,
  CONNECT_SHOPIFY_STORE,
  ENTER_PLAN_MODE,
  EXIT_PLAN_MODE,
  GET_GOAL,
  CREATE_GOAL,
  UPDATE_GOAL,
  ...SCHEDULE_TOOL_NAMES,
  PRESENT_TOOL,
  SHOW_WIDGET,
  "undo_last_change",
  SUBAGENT_TOOL,
  SUBAGENT_FORK_TOOL,
  INTERRUPT_AGENT_TOOL,
  LIST_AGENTS_TOOL,
  // A «Crear» card is the main conversation's (spec local 2026-11-04-herramientas-hechas-por-len, §4.10).
  PROPOSE_ACTION,
  // So is the card to create the person's own assistant (spec local 2026-11-06-asistente-propio, §4.4).
  CREATE_ASSISTANT,
]);

/** The artifact tools that only read. */
const ARTIFACT_READS: ReadonlySet<string> = new Set(["list_artifacts", "inspect_artifact", "list_artifact_audio"]);

/** Out as well for a read-only child: everything that writes. What `bash` changes is refused apart (§4.2). */
/** What a read-only session can't run; the person's own assistant drops these too (lib/assistants/agent.ts). */
export const OUT_FOR_READ_ONLY: ReadonlySet<string> = new Set([
  "Write",
  "Edit",
  "edit_image",
  "toggle_module",
  CONVERTIR_EN_APP,
  "draft_reply",
  ...ARTIFACT_TOOLS.filter((t) => !ARTIFACT_READS.has(t)),
]);

/** `Explore` and `Plan` never write; in plan mode, `general-purpose` doesn't either. */
export function isReadOnly(preset: SubagentPreset, planMode: boolean): boolean {
  return preset !== "general-purpose" || planMode;
}

/** Claude Code's `omitClaudeMd: true` on `Explore` and `Plan`. */
export function omitsLenMd(preset: SubagentPreset): boolean {
  return preset !== "general-purpose";
}

/** An installed tool's operation (`mcp__<server>__<operation>`, spec local 2026-11-04-herramientas-hechas-por-len, §4.7):
 *  it writes the person's production, so only the main turn has it — never a child, read-only or not. The same holds
 *  for the person's MCP connectors (spec local 2026-11-06-conectores-mcp, §5.6), which share the prefix and can write
 *  outside OpenLen: a read-only child (Explore, Plan) must stay read-only. */
function isToolOperation(name: string): boolean {
  return name.startsWith("mcp__");
}

export function childToolDeclarations(
  all: readonly Record<string, unknown>[],
  preset: SubagentPreset,
  planMode: boolean,
): Record<string, unknown>[] {
  const readOnly = isReadOnly(preset, planMode);
  return all.filter((d) => {
    const name = String(d.name);
    return !OUT_FOR_EVERY_CHILD.has(name) && !isToolOperation(name) && !(readOnly && OUT_FOR_READ_ONLY.has(name));
  });
}

export const DELEGATION_SCOPE_STATEMENT =
  "You are a delegated subagent: your permission scope was fixed when you were started and cannot be widened from inside this session — operations that require approval are rejected automatically. When the job needs access beyond that scope, do not retry the denied operation; state the limitation in your reply so the delegating agent can handle it.";

const SECTIONS: Readonly<Record<SubagentPreset, string>> = {
  "general-purpose": `SUBAGENT — GENERAL-PURPOSE:
You are a subagent that Len started for one task: the last message. Do the work yourself, with your tools, until it is done — research, search the project, change files when the task asks for it. Do not hand the whole task to another agent. Don't create files nobody asked for, like notes or reports, unless the task asks for them.
Nobody but Len reads you, and he gets only what you send him with send_message and your final message: report clearly what you did and found — the files and lines that changed or matter, and what you could not do and why.`,
  Explore: `SUBAGENT — EXPLORE:
You are a fast, read-only search agent that Len started to find things in this project. You locate; you don't review, audit or fix. You can't change the project's files: Write and Edit are not yours, and whatever a terminal command changes in them is refused.
Read excerpts rather than whole files, and search with Grep, Glob and the terminal. The task says how far to look: "quick" for the likely place, "medium" for a moderate search, "very thorough" for every location and naming.
Len gets only what you send him with send_message and your final message: answer with what you found, with file paths and line numbers, and say what you looked for and didn't find.`,
  Plan: `SUBAGENT — PLAN:
You are a read-only planning agent that Len started: you explore this project and design how to carry out the task you are given. You can't change the project's files: Write and Edit are not yours, and whatever a terminal command changes in them is refused.
Read what the plan depends on before you decide.
Len gets only what you send him with send_message and your final message: give him a step-by-step plan, the files that are critical to carry it out, and the trade-offs that matter.`,
};

/** Len's prompt without the delegation line (the child has no `subagent`), then its type and DeepSeek's statement. */
export function childSystemPrompt(lenSystemPrompt: string, preset: SubagentPreset, guidanceLine: string): string {
  return `${lenSystemPrompt.replace(`\n- ${guidanceLine}`, "")}\n\n${SECTIONS[preset]}\n\n${DELEGATION_SCOPE_STATEMENT}`;
}

export type ChildType = { readonly kind: "builtin"; readonly preset: SubagentPreset } | { readonly kind: "custom"; readonly type: ResolvedAgentType };

export function childTypeOf(name: string, types: AgentTypeSet): ChildType | null {
  if ((SUBAGENT_PRESETS as readonly string[]).includes(name)) return { kind: "builtin", preset: name as SubagentPreset };
  const type = types.get(name);
  return type ? { kind: "custom", type } : null;
}

export function isReadOnlyFor(type: ChildType, planMode: boolean): boolean {
  return type.kind === "builtin" ? isReadOnly(type.preset, planMode) : planMode;
}

export function omitsLenMdFor(type: ChildType): boolean {
  return type.kind === "builtin" ? omitsLenMd(type.preset) : type.type.agent.omitLenMd;
}

export function childToolsFor(all: readonly Record<string, unknown>[], type: ChildType, planMode: boolean): Record<string, unknown>[] {
  if (type.kind === "builtin") return childToolDeclarations(all, type.preset, planMode);
  const a = type.type.agent;
  return all.filter((d) => {
    const name = String(d.name);
    return !OUT_FOR_EVERY_CHILD.has(name) && !isToolOperation(name) && !(planMode && OUT_FOR_READ_ONLY.has(name)) &&
      (a.tools === null || a.tools.includes(name)) && !a.disallowedTools.includes(name);
  });
}

export function childSystemPromptFor(lenSystemPrompt: string, type: ChildType, guidanceLine: string): string {
  if (type.kind === "builtin") return childSystemPrompt(lenSystemPrompt, type.preset, guidanceLine);
  const a = type.type.agent;
  return `${lenSystemPrompt.replace(`\n- ${guidanceLine}`, "")}\n\nSUBAGENT — ${a.name.toUpperCase()}:\n${a.body}\n\n${DELEGATION_SCOPE_STATEMENT}`;
}
