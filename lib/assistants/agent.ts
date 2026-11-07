// THE PERSON'S OWN ASSISTANT ON LEN'S ENGINE (spec local 2026-11-06-asistente-propio, §4.1, §4.2): like Claude
// Code's `--agent <name>`, the owner's turn with their assistant runs Len's loop with this as its main thread.
//
// Its tools are INHERITED: Len's declarations, in Len's order, minus what builds and minus its definition's
// `disallowedTools` — never a list of what it may use, so whatever Len gains tomorrow it has without a change here
// (Jesús, 06/11: «if we give it 5 of Len's 30 things, something will always be missing»). It is a main thread, not a
// child: it keeps what every subagent loses (asking the owner, visuals, scheduled tasks, `present` and the person's MCP
// operations). Subagents are the one exception, for now (`SUBAGENTS_NOT_YET`).
//
// Cache effect: its system prompt is Len's byte for byte plus its section at the end, and its tools are Len's in
// Len's order with some taken out.
//
// Pure.

import { CONNECT_EMAIL_DOMAIN, REQUEST_SECRETS } from "@/lib/agent/ask-user-question";
import { CONNECT_SHOPIFY_STORE } from "@/lib/agent/connect-shopify-store";
import { SET_FORM_AUTO_REPLY } from "@/lib/agent/form-auto-reply";
import { CREATE_GOAL, GET_GOAL, UPDATE_GOAL } from "@/lib/agent/goal-tools";
import { ENTER_PLAN_MODE, EXIT_PLAN_MODE } from "@/lib/agent/plan-mode";
import { ASSISTANT_AGENT_TYPE } from "@/lib/agent/subagents/bundled-types";
import { INTERRUPT_AGENT_TOOL, LIST_AGENTS_TOOL, SEND_MESSAGE_TOOL, SUBAGENT_FORK_TOOL, SUBAGENT_TOOL } from "@/lib/agent/subagents/enabled";
import { OUT_FOR_READ_ONLY } from "@/lib/agent/subagents/presets";
import { PROPOSE_ACTION } from "@/lib/tools/cards/types";

import { CREATE_ASSISTANT } from "./create-tool";
import type { AssistantTone } from "./names";

export const ASSISTANT_MEMORY_PATH = "~/.assistant/MEMORY.md";

/** What builds, beyond what a read-only session can't run: publishing, undoing Len's turn, the backend's secrets and
 *  the project's connections, Len's multi-round goals, plan mode, and the «Crear» card of a tool. */
const BUILDS: ReadonlySet<string> = new Set([
  "publish",
  "undo_last_change",
  REQUEST_SECRETS,
  CONNECT_EMAIL_DOMAIN,
  SET_FORM_AUTO_REPLY,
  CONNECT_SHOPIFY_STORE,
  GET_GOAL,
  CREATE_GOAL,
  UPDATE_GOAL,
  ENTER_PLAN_MODE,
  EXIT_PLAN_MODE,
  PROPOSE_ACTION,
  // An assistant doesn't make assistants: that card is Len's.
  CREATE_ASSISTANT,
]);

/** Not in phase 1, and not by choice: a subagent's settlement notice is kept per PROJECT and, once the launching turn
 *  is gone, wakes LEN in the project chat (`launchSubagentNoticeTurn`), and runs are found in Len's conversation. The
 *  assistant's work would land in Len's chat. They come back when notices are routed by conversation. */
const SUBAGENTS_NOT_YET: ReadonlySet<string> = new Set([SUBAGENT_TOOL, SUBAGENT_FORK_TOOL, SEND_MESSAGE_TOOL, INTERRUPT_AGENT_TOOL, LIST_AGENTS_TOOL]);

export function assistantTools(declarations: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const disallowed = new Set(ASSISTANT_AGENT_TYPE.disallowedTools);
  return declarations.filter((d) => {
    const name = String(d.name);
    return !OUT_FOR_READ_ONLY.has(name) && !BUILDS.has(name) && !SUBAGENTS_NOT_YET.has(name) && !disallowed.has(name);
  });
}

const TONES: Readonly<Record<AssistantTone, string>> = {
  friendly: "warm and friendly",
  formal: "formal and polite",
  playful: "playful and light",
};

/** Len's prompt, then the assistant's section and who it is. */
export function assistantSystemPrompt(lenSystemPrompt: string, a: { name: string; tone: string }): string {
  const tone = TONES[a.tone as AssistantTone] ?? TONES.friendly;
  return [
    lenSystemPrompt,
    `ASSISTANT — ${a.name.toUpperCase()}:\n${ASSISTANT_AGENT_TYPE.body}`,
    `Your name is ${a.name}. Your owner gave you that name and chose how you look; you are theirs. Talk with them in a ${tone} way, in their language. Your memory is ${ASSISTANT_MEMORY_PATH}.`,
  ].join("\n\n");
}
