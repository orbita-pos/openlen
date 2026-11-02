// THE `subagent` TOOL (spec local 2026-11-01-subagentes-de-len, §4.1): DeepSeek Harness's
// (`packages/subagent/tool-subagent/src/index.ts` @ ce7073d, MIT, LICENSES/deepseek-harness.MIT.txt) for
// a fresh child that cannot be continued: its name, its description and its `description` and `prompt`
// parameters word for word, and its answer, `started subagent <id>`. Always in the background, as
// DeepSeek's (Jesús, 01/11). `agent_preset` is DeepSeek's parameter; what it picks are Claude Code's
// three types. The line per type and the two closing sentences are ours.
//
// The tool only validates and hands over: the launcher (`deps.subagents`, lib/agent/subagents/run.ts)
// builds and runs the child, and its notice reaches Len later.
//
// Cache effect: the declaration is fixed per server (OPENLEN_SUBAGENTS); its answer is appended.

import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";

import { SUBAGENT_TOOL } from "./enabled";
import { startedLine } from "./notice";
import { SUBAGENT_PRESETS, type SubagentPreset } from "./presets";

/** DeepSeek's `tool:subagent` system-prompt section, with only `subagent` visible. */
export const SUBAGENT_GUIDANCE =
  "Start independent delegations with `subagent` together in one assistant message and continue useful work while they run. When only waiting for their results remains, end your turn instead of sleeping or polling; the next result starts a new turn.";

const DESCRIPTION = [
  // DeepSeek's `providerWording(false)` + its backend sentences for a child without `send_message`.
  "Delegate a self-contained task to a subagent (a separate agent that works in its own context) to offload focused, independent work — research, a scoped implementation, an analysis — so it does not consume this conversation's context. The subagent returns its result, not its intermediate steps.",
  "This tool starts an independently managed subagent and immediately returns its id. The runtime notifies you when it finishes. The completion notice includes its final answer. This backend does not accept follow-up messages.",
  // Ours: the three types (Claude Code's), and what Claude Code says that DeepSeek doesn't.
  "Types (agent_preset): general-purpose (the default) works on the task with your tools and can change files; Explore is a fast, read-only search of the project that answers with paths and lines — say how far to look: quick, medium or very thorough; Plan is read-only and answers with a step-by-step plan and the files it depends on.",
  "Its final message is not shown to the user: tell them what matters. Never report or guess a subagent's result before its notice arrives.",
].join(" ");

export const SUBAGENT_DECLARATION: Record<string, unknown> = {
  name: SUBAGENT_TOOL,
  description: DESCRIPTION,
  parameters: {
    type: "OBJECT",
    properties: {
      description: { type: "STRING", description: "A short (3-5 word) description of the delegated task, for display." },
      prompt: {
        type: "STRING",
        description: "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs.",
      },
      agent_preset: { type: "STRING", enum: [...SUBAGENT_PRESETS], description: "The type of subagent; general-purpose when omitted." },
    },
    required: ["description", "prompt"],
  },
};

export type LaunchRefusal = "too_many_subagents" | "turn_budget_reached" | "subagents_disabled";

export interface SubagentsDeps {
  launch(o: { description: string; prompt: string; preset: SubagentPreset }): Promise<{ ok: true; id: string } | { ok: false; code: LaunchRefusal; message: string }>;
}

const invalid = (message: string): ToolOutcome => ({ response: { ok: false, error: "invalid_arguments", message } });

export async function toolSubagent(_session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  const description = typeof args.description === "string" ? args.description.trim() : "";
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!description) return invalid("description is required: a short (3-5 word) description of the task.");
  if (!prompt) return invalid("prompt is required: the complete, self-contained task.");
  const preset = args.agent_preset ?? "general-purpose";
  if (!SUBAGENT_PRESETS.includes(preset as SubagentPreset)) {
    return invalid(`agent_preset must be one of ${SUBAGENT_PRESETS.join(", ")}.`);
  }
  if (!deps.subagents) return { response: { ok: false, error: "subagents_disabled", message: "Subagents are not available in this session." } };
  const r = await deps.subagents.launch({ description, prompt, preset: preset as SubagentPreset });
  if (!r.ok) return { response: { ok: false, error: r.code, message: r.message } };
  return { response: { ok: true, tool_result: startedLine(r.id) }, action: { tool: SUBAGENT_TOOL, ok: true, summary: description } };
}
