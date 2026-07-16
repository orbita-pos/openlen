"use client";

// Shared inbox-badge state — polls GET /api/inbox/badge (60s + window focus)
// and lets any instance mark leads seen. Instances sync through the
// "ol:inbox-badge" window event (rail + hub live in the same document), so
// clearing the tab clears the rail without new global state. Network failure
// = null = no badge; the badge is informative, never an error surface.

import { useCallback, useEffect, useState } from "react";

export interface InboxBadgeCounts {
  chat: number;
  leads: number;
}

const POLL_MS = 60_000;
const SYNC_EVENT = "ol:inbox-badge";

export function useInboxBadge(): {
  counts: InboxBadgeCounts | null;
  markLeadsSeen: () => Promise<void>;
} {
  const [counts, setCounts] = useState<InboxBadgeCounts | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/badge");
      if (!res.ok) {
        setCounts(null);
        return;
      }
      const d = (await res.json()) as Partial<InboxBadgeCounts>;
      setCounts({ chat: Number(d.chat) || 0, leads: Number(d.leads) || 0 });
    } catch {
      setCounts(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const iv = setInterval(() => void refresh(), POLL_MS);
    const onWake = () => void refresh();
    window.addEventListener("focus", onWake);
    window.addEventListener(SYNC_EVENT, onWake);
    return () => {
      clearInterval(iv);
      window.removeEventListener("focus", onWake);
      window.removeEventListener(SYNC_EVENT, onWake);
    };
  }, [refresh]);

  const markLeadsSeen = useCallback(async () => {
    // Optimistic: the tab just opened, the user is looking at the leads.
    setCounts((c) => (c ? { ...c, leads: 0 } : c));
    try {
      await fetch("/api/inbox/badge/seen", { method: "POST" });
    } catch {
      // Badge failures never surface; the next poll reconciles.
    } finally {
      window.dispatchEvent(new Event(SYNC_EVENT));
    }
  }, []);

  return { counts, markLeadsSeen };
}
