"use client";

// LAS CHARLAS DEL PROYECTO en el chat nuevo (plans/new-chat/): «Empezar de cero»
// archiva la charla en curso y se puede volver a una archivada. El servidor
// manda (`/api/projects/[id]/chat/conversations`): con un turno trabajando dice
// 409 y aquí se cuenta como `busy`, sin tocar la vista.

import { useCallback, useState } from "react";

export interface ArchivedConversationView {
  readonly id: string;
  readonly title: string;
  readonly turns: number;
  readonly startedAt: number;
  readonly endedAt: number;
}

export type ConversationActionResult = "ok" | "busy" | "error";

export function useConversations(projectId: string, onChanged: () => void) {
  const [archived, setArchived] = useState<readonly ArchivedConversationView[] | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${projectId}/chat/conversations`, { cache: "no-store" });
      const d = (await r.json().catch(() => null)) as { conversations?: ArchivedConversationView[] } | null;
      setArchived(r.ok && Array.isArray(d?.conversations) ? d.conversations : []);
    } catch {
      setArchived([]);
    }
  }, [projectId]);

  const change = useCallback(
    async (body: { action: "new" } | { action: "reopen"; conversation: string }): Promise<ConversationActionResult> => {
      setPending(true);
      try {
        const r = await fetch(`/api/projects/${projectId}/chat/conversations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (r.status === 409) return "busy";
        if (!r.ok) return "error";
        onChanged();
        void load();
        return "ok";
      } catch {
        return "error";
      } finally {
        setPending(false);
      }
    },
    [load, onChanged, projectId],
  );

  return {
    /** null hasta la primera carga. */
    archived,
    pending,
    load,
    startNew: useCallback(() => change({ action: "new" }), [change]),
    reopen: useCallback((conversation: string) => change({ action: "reopen", conversation }), [change]),
  };
}
