// THE PERSON'S OWN ASSISTANT ON LEN'S ENGINE (spec local 2026-11-06-asistente-propio, §4.1, §4.2): like Claude
// Code's `--agent <name>`, the owner's turn with their assistant runs Len's loop with this as its main thread.
//
// Its tools are INHERITED: Len's declarations, in Len's order, minus what builds and minus its definition's
// `disallowedTools` — never a list of what it may use, so whatever Len gains tomorrow it has without a change here
// (Jesús, 06/11: «if we give it 5 of Len's 30 things, something will always be missing»). It is a main thread, not a
// child: it keeps what every subagent loses (asking the owner, visuals, scheduled tasks, `present` and the person's MCP
// operations). Subagents are the one exception, for now (`SUBAGENTS_NOT_YET`).
//
// Cache effect: its own prefix is stable from turn to turn (Len's system prompt without the subagent line, plus its
// section; Len's tools in Len's order with some taken out). It never shares a cached prefix with Len's turns: the tool
// lists differ.
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
import { SUBAGENT_GUIDANCE } from "@/lib/agent/subagents/tool";
import { PROPOSE_ACTION } from "@/lib/tools/cards/types";

import { PROPOSE_SKILLS } from "@/lib/agent/skills/propose-tool";

import { CREATE_ASSISTANT } from "./create-tool";
import { CREATE_AB_VARIANT } from "@/lib/agent/tools-ab-name";
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
  // Nor proposes the person's skills: changing ~/.len/ is Len's job (spec local 2026-11-19-agentes-para-todos, §6.4).
  PROPOSE_SKILLS,
  // An assistant never edits pages directly: she asks Len via ask_len to build Variant B.
  CREATE_AB_VARIANT,
]);

/** Not in phase 1, and not by choice: a subagent's settlement notice is kept per PROJECT and, once the launching turn
 *  is gone, wakes LEN in the project chat (`launchSubagentNoticeTurn`), and runs are found in Len's conversation. The
 *  assistant's work would land in Len's chat. They come back when notices are routed by conversation. */
const SUBAGENTS_NOT_YET: ReadonlySet<string> = new Set([SUBAGENT_TOOL, SUBAGENT_FORK_TOOL, SEND_MESSAGE_TOOL, INTERRUPT_AGENT_TOOL, LIST_AGENTS_TOOL]);

/** Her memory's tools: Claude Code gives a subagent with memory Read, Write and Edit for it, and spec §8 says she writes
 *  ~/.assistant/MEMORY.md with them. Her session is read-only, so both refuse every other file (`escribeSuMemoria`). */
const FOR_HER_MEMORY: ReadonlySet<string> = new Set(["Write", "Edit"]);

/** An agent opens its own published tool with view_page / use_page (spec local 2026-11-22-herramienta-dentro-del-agente,
 *  §5): declared only on an agent's turn, so Len's declarations stay byte for byte identical. */
const AGENT_TOOL_EYES_PARAM = {
  type: "STRING",
  description:
    "Optional: the slug of one of your published tools (/tools/<your slug>/<tool name>/). Opens its published version with window.openlen.data running on a throwaway copy of its real data — writes while testing never touch your person's data.",
};

function withAgentToolEyes(d: Record<string, unknown>): Record<string, unknown> {
  const parameters = (d.parameters ?? { type: "OBJECT", properties: {} }) as {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return { ...d, parameters: { ...parameters, properties: { ...(parameters.properties ?? {}), tool: AGENT_TOOL_EYES_PARAM } } };
}

export function assistantTools(declarations: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const disallowed = new Set(ASSISTANT_AGENT_TYPE.disallowedTools);
  return declarations
    .filter((d) => {
      const name = String(d.name);
      return (FOR_HER_MEMORY.has(name) || !OUT_FOR_READ_ONLY.has(name)) && !BUILDS.has(name) && !SUBAGENTS_NOT_YET.has(name) && !disallowed.has(name);
    })
    .map((d) => (d.name === "view_page" || d.name === "use_page" ? withAgentToolEyes(d) : d));
}

export const TONES: Readonly<Record<AssistantTone, string>> = {
  friendly: "warm and friendly",
  formal: "formal and polite",
  playful: "playful and light",
};

/** The tone a stored value names, or `friendly`: the store's value is a string, and only an own key counts (a name every
 *  object has, like «toString», would reach the prototype). Her chat and the visitors' bubble use this same rule. */
export function toneKeyOf(tone: string): AssistantTone {
  return Object.hasOwn(TONES, tone) ? (tone as AssistantTone) : "friendly";
}

/** EMOJIS BY TONE (spec local 2026-11-21-emojis-en-el-chat): the agent inherits Len's line in TONE (`EMOJIS_IN_CHAT`),
 *  and this, said after it, adjusts it — friendly is Len's, so it adds nothing and its prompt stays what it was. */
export const TONE_EMOJIS: Readonly<Record<AssistantTone, string>> = {
  friendly: "",
  playful: " Emojis can come a bit more often than TONE says, still never one per line.",
  formal: " Formal means no emojis in your messages.",
};

/** AN AGENT OF THE PERSON'S, WITH A FILE (spec local 2026-11-19-agentes-para-todos, §6.4): what it is for is in its
 *  file, so this body says nothing of a business; and its memory is private — what a page's visitors may hear is
 *  CUSTOMERS.md (§6.7). Len may write to it, and it answers him with `message_len` (spec local
 *  2026-11-21-len-y-el-agente-conversan, §7). It may also build its own private tools in `/tools/<slug>/` (spec local
 *  2026-11-22-herramienta-dentro-del-agente, §6). An assistant without a file keeps `ASSISTANT_AGENT_TYPE.body`, byte for byte. */
function agentBody(slug?: string | null): string {
  const folder = slug && slug.trim() !== "" ? `/tools/${slug.trim()}/` : "/tools/<your slug>/";
  return `You are the person's own agent, not Len. What you are for, and how you talk, is in your instructions below: follow them. You answer, look things up, keep track, remind, make documents in /tmp, and keep your work in files of the person's space, your working folder. You never build pages or apps — you do not publish sites or convert anything; when the person asks for a page, an app or a change to one, pass it to Len with ask_len, in their own words, and tell them you did. The one exception is your own tools in ${folder} (one folder per tool, with index.html, published with publish_tool): they live inside you as a tab, are seen only by your person and are never published to the web. Load the agent-tools skill before writing one.
Len may write to you; to answer him or tell him something about a project, use message_len. His messages come marked as Len's, never your person's; work is still asked with ask_len.
What you learn about the person goes in ${ASSISTANT_MEMORY_PATH}, which is yours alone: it is loaded at the start of the conversation; when you learn something new, replace it whole with Write or change it with Edit. Longer work — a plan, flashcards, notes — goes in files of the space, not in memory.
If you attend a page listed in ~/.assistant/PROJECTS.md, its visitors never see your memory or your files: what they may be told is ~/.assistant/CUSTOMERS.md, which you write only when the person asks you to.

## What NOT to save in memory
- What the person's pages say: you read it in ~/.assistant/PROJECTS.md, and it changes when the pages do.
- What visitors said or asked: it is in list_messages.
- Passwords, keys or other credentials.`;
}

/** Len's prompt, then the assistant's section and who it is — and, for an agent with a file, its instructions last, as
 *  Claude Code appends an agent's prompt after its own (`appendSystemPrompt`; we keep Len's: Jesús, 06/11). */
export function assistantSystemPrompt(lenSystemPrompt: string, a: { name: string; slug?: string | null; tone: string; instructions?: string | null }): string {
  const toneKey = toneKeyOf(a.tone);
  const tone = TONES[toneKey];
  const withFile = typeof a.instructions === "string" && a.instructions.trim() !== "";
  return [
    // Without Len's subagent line, as a child's prompt drops it (`childSystemPromptFor`): it has no subagent tools.
    lenSystemPrompt.replace(`\n- ${SUBAGENT_GUIDANCE}`, ""),
    `ASSISTANT — ${a.name.toUpperCase()}:\n${withFile ? agentBody(a.slug) : ASSISTANT_AGENT_TYPE.body}`,
    `Your name is ${a.name}. Your owner gave you that name and chose how you look; you are theirs. Talk with them in a ${tone} way, in their language.${TONE_EMOJIS[toneKey]} Your memory is ${ASSISTANT_MEMORY_PATH}.`,
    ...(withFile ? [`YOUR INSTRUCTIONS:\n${a.instructions!.trim()}`] : []),
  ].join("\n\n");
}
