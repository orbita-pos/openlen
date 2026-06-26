import type { MessageRow } from "@/lib/chat/store";

export type HubEvent =
  | { type: "message"; message: MessageRow }
  | { type: "presence"; userId: string; online: boolean }
  | { type: "typing"; userId: string; isTyping: boolean }
  | { type: "read"; userId: string; readAt: string }
  | { type: "assignment"; conversationId: string; assignedUserId: string | null; assigneeName: string | null; assignedAt: string | null };

export interface Subscriber {
  id: string;
  userId: string;
  send: (evt: HubEvent) => void;
}

interface PresenceEntry {
  count: number;
  // Grace timer: started when refcount hits 0 so a page-refresh reconnect
  // doesn't briefly appear offline to isProjectStaffOnline callers.
  offlineTimer?: ReturnType<typeof setTimeout>;
}

export function createHub() {
  // conversationId → Map<subId, Subscriber>
  const subs = new Map<string, Map<string, Subscriber>>();

  // projectId → Map<userId, PresenceEntry>
  const presence = new Map<string, Map<string, PresenceEntry>>();

  function subscribe(conversationId: string, sub: Subscriber): () => void {
    let byId = subs.get(conversationId);
    if (!byId) {
      byId = new Map();
      subs.set(conversationId, byId);
    }
    byId.set(sub.id, sub);
    return () => {
      const m = subs.get(conversationId);
      if (m) {
        m.delete(sub.id);
        if (m.size === 0) subs.delete(conversationId);
      }
    };
  }

  function publish(conversationId: string, evt: HubEvent): void {
    const byId = subs.get(conversationId);
    if (!byId) return;
    for (const [id, sub] of byId) {
      try {
        sub.send(evt);
      } catch {
        // Prune dead connections: a closed SSE socket throws on write.
        // Removing here prevents the broken entry from accumulating and
        // blocking delivery to healthy subscribers on future publishes.
        byId.delete(id);
      }
    }
    // If pruning emptied the inner map, remove the conversation key too.
    if (byId.size === 0) subs.delete(conversationId);
  }

  function markOnline(projectId: string, userId: string): void {
    let byUser = presence.get(projectId);
    if (!byUser) {
      byUser = new Map();
      presence.set(projectId, byUser);
    }
    const entry = byUser.get(userId);
    if (entry) {
      // Cancel any pending offline grace timer — the user reconnected before
      // the grace window expired (e.g. page refresh / re-open tab).
      if (entry.offlineTimer !== undefined) {
        clearTimeout(entry.offlineTimer);
        entry.offlineTimer = undefined;
      }
      entry.count++;
    } else {
      byUser.set(userId, { count: 1 });
    }
  }

  function markOffline(projectId: string, userId: string): void {
    const byUser = presence.get(projectId);
    if (!byUser) return;
    const entry = byUser.get(userId);
    if (!entry) return;
    entry.count = Math.max(0, entry.count - 1);
    if (entry.count > 0) return; // still has other open connections

    // Already at 0 with a grace timer running — don't double-schedule.
    if (entry.offlineTimer !== undefined) return;

    // Refcount hit 0. Start a ~12s grace timer before truly removing the entry.
    // This prevents a page refresh from briefly flipping the owner "offline"
    // and sending an unnecessary email notification to a visitor who's still there.
    entry.offlineTimer = setTimeout(() => {
      const m = presence.get(projectId);
      if (m) {
        m.delete(userId);
        if (m.size === 0) presence.delete(projectId);
      }
    }, 12_000);
  }

  function isUserOnline(projectId: string, userId: string): boolean {
    const entry = presence.get(projectId)?.get(userId);
    // An entry with count > 0 is online. An entry with count === 0 is in
    // the grace window (offlineTimer pending) — treat as still online so
    // callers don't trigger spurious offline actions during reconnects.
    // Online if actively connected OR within the grace window (offlineTimer pending).
    return entry !== undefined && (entry.count > 0 || entry.offlineTimer !== undefined);
  }

  function isProjectStaffOnline(
    projectId: string,
    ownerUserId: string,
    agentIds: string[],
  ): boolean {
    if (isUserOnline(projectId, ownerUserId)) return true;
    return agentIds.some((id) => isUserOnline(projectId, id));
  }

  return { subscribe, publish, markOnline, markOffline, isUserOnline, isProjectStaffOnline };
}

// Module-level singleton: Next.js runs as a single long-lived process on
// Hetzner, so module state survives across requests without Redis.
export const hub = createHub();
