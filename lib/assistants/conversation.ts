// The owner's conversation with their assistant lives in `projectChatMessages` of the project it was born in, under
// its own `conversation` key. Len's chat only ever reads `conversation IS NULL`, so it never sees these rows, and the
// archived chats leave them out (spec local 2026-11-06-asistente-propio, §4.1, §4.6).
//
// Pure.

export const ASSISTANT_CONVERSATION_PREFIX = "assistant:";

export function assistantConversationKey(id: string): string {
  return `${ASSISTANT_CONVERSATION_PREFIX}${id}`;
}

export function isAssistantConversation(key: string | null | undefined): boolean {
  return typeof key === "string" && key.startsWith(ASSISTANT_CONVERSATION_PREFIX);
}
