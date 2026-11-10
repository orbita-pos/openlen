// «QUIERO UN ASISTENTE» (spec local 2026-11-06-asistente-propio, §4.4): Len's `create_assistant` offers the owner the
// creator's card. It creates nothing: the owner names it and picks its look on the card (the creator, like Muse), and
// the card's button does the creating (`POST /api/assistants`). If the project already has one, Len hears which. If the
// owner already has one elsewhere (phase 4, step 2), Len hears its name and asks «¿la uso también aquí o creas otro?»;
// the card offers both.
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

export interface CreateAssistantDeps {
  assistantOfProject(projectId: string): Promise<Pick<AssistantRow, "name" | "slug"> | null>;
  /** The person's own, newest first. */
  assistantsOf(personId: string): Promise<Pick<AssistantRow, "name" | "slug">[]>;
}

async function storeDeps(): Promise<CreateAssistantDeps> {
  const store = await import("./store");
  return { assistantOfProject: store.assistantOfProject, assistantsOf: store.assistantsOf };
}

export async function runCreateAssistant(session: AgentSession, deps?: CreateAssistantDeps): Promise<ToolOutcome> {
  if (session.assistant) return { response: { ok: false, error: "not_available", message: "Only Len offers a new assistant." } };
  if (!assistantsEnabled()) return { response: { ok: false, error: "assistants_off", message: "Assistants are turned off right now." } };
  const d = deps ?? (await storeDeps());
  const existing = await d.assistantOfProject(session.projectId);
  if (existing) {
    return { response: { ok: false, error: "project_has_assistant", assistant: { name: existing.name, slug: existing.slug }, message: `This project already has its assistant, ${existing.name}.` } };
  }
  // The session's user is the project's owner (a member never gets this tool): their own assistants, elsewhere.
  const theirs = (await d.assistantsOf(session.userId)).map((a) => ({ name: a.name, slug: a.slug }));
  const tool_result = theirs.length
    ? `The owner already has ${theirs.map((a) => a.name).join(", ")}. Ask them whether to use ${theirs.length > 1 ? "one of them" : theirs[0]!.name} here too or create another: the card under your answer offers both.`
    : "The owner now sees the card to create their assistant: they pick its name and its look there.";
  return {
    response: { ok: true, card: "assistant_create", ...(theirs.length ? { existing: theirs } : {}), tool_result },
    action: { tool: CREATE_ASSISTANT, ok: true, summary: CREATE_ASSISTANT },
  };
}
