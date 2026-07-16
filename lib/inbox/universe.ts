// The chat-count project universe for the inbox badge — the SAME set the
// Bandeja lists (lib/chat/store.ts listInbox): owned projects + active-agent
// projects, chat-enabled only. If the badge counted anything the Bandeja
// doesn't show, it would be a phantom number. Pure orchestration with
// injected lookups so it tests without a DB.

export interface ChatUniverseDeps {
  ownedProjects(
    userId: string,
  ): Promise<Array<{ id: string; chatEnabled: boolean }>>;
  agentProjectIds(userId: string): Promise<string[]>;
  /** null = project gone. */
  projectChatEnabled(projectId: string): Promise<boolean | null>;
}

export async function resolveChatUniverse(
  userId: string,
  deps: ChatUniverseDeps,
): Promise<string[]> {
  const owned = await deps.ownedProjects(userId);
  const ids = owned.filter((p) => p.chatEnabled).map((p) => p.id);
  const ownedIds = new Set(owned.map((p) => p.id));
  for (const pid of await deps.agentProjectIds(userId)) {
    if (ownedIds.has(pid)) continue;
    if ((await deps.projectChatEnabled(pid)) === true) ids.push(pid);
  }
  return ids;
}
