// «QUIERO UN ASISTENTE» (spec local 2026-11-06-asistente-propio, §4.4): Len's `create_assistant` offers the owner the
// creator's card. It creates nothing: the owner names it and picks its look on the card (the creator, like Muse), and
// the card's button does the creating (`POST /api/assistants`). If the project already has one, Len hears which.
import type { AgentSession, ToolOutcome } from "@/lib/agent/tools";

import { assistantsEnabled } from "./enabled";
import type { AssistantRow } from "./store";

export const CREATE_ASSISTANT = "create_assistant";

export const CREATE_ASSISTANT_DECLARATION = {
  name: CREATE_ASSISTANT,
  description:
    "Shows the owner the card to create their own assistant: a chat assistant of theirs, with the name and the look they pick, that knows their business and talks with them about it — not you. " +
    "Call it when the owner asks for an assistant, a chatbot or an AI of their own. It creates nothing: the owner names it and picks its look on the card. " +
    "If this project already has one, you get which, and say so.",
  parameters: { type: "OBJECT", properties: {} },
} as const;

export async function runCreateAssistant(
  session: AgentSession,
  assistantOfProject: (projectId: string) => Promise<Pick<AssistantRow, "name" | "slug"> | null> = async (projectId) =>
    (await import("./store")).assistantOfProject(projectId),
): Promise<ToolOutcome> {
  if (session.assistant) return { response: { ok: false, error: "not_available", message: "Only Len offers a new assistant." } };
  if (!assistantsEnabled()) return { response: { ok: false, error: "assistants_off", message: "Assistants are turned off right now." } };
  const existing = await assistantOfProject(session.projectId);
  if (existing) {
    return { response: { ok: false, error: "project_has_assistant", assistant: { name: existing.name, slug: existing.slug }, message: `This project already has its assistant, ${existing.name}.` } };
  }
  return {
    response: { ok: true, card: "assistant_create", tool_result: "The owner now sees the card to create their assistant: they pick its name and its look there." },
    action: { tool: CREATE_ASSISTANT, ok: true, summary: CREATE_ASSISTANT },
  };
}
