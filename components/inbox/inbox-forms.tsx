"use client";

// Formularios tab of the /inbox hub — fetches the cross-project leads inbox
// (GET /api/messages) and renders the shared MessagesView. JSON turns createdAt
// into a string — revive it (LeadCard calls .toLocaleString on it).

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { MessagesView, type DashLead } from "./leads-view";

export function InboxForms() {
  const [leads, setLeads] = useState<DashLead[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/messages")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { leads?: unknown[] } | null) => {
        if (cancelled) return;
        if (!d) {
          setLeads([]); // failure → show empty state, never an infinite spinner
          return;
        }
        const list = (d.leads ?? []).map((raw) => {
          const l = raw as DashLead & { createdAt: string };
          return { ...l, createdAt: new Date(l.createdAt) } as DashLead;
        });
        setLeads(list);
      })
      .catch(() => {
        if (!cancelled) setLeads([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-white dark:bg-[#0a0a0a]">
      {leads ? (
        <MessagesView leads={leads} />
      ) : (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      )}
    </div>
  );
}
