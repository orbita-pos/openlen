"use client";

// Workspace-only wrapper: fetches the leads inbox client-side (GET /api/messages)
// and renders the SAME MessagesView in the editor center. JSON turns createdAt
// into a string — revive it (LeadCard calls .toLocaleString on it).

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ALL_BUSINESSES } from "@/components/workspace-v2/business-switcher";
import { MessagesView, type DashLead } from "./messages-view";

export function MessagesSection({
  activeBusinessId,
}: {
  activeBusinessId?: string;
}) {
  const [leads, setLeads] = useState<DashLead[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLeads(null);
    const qs =
      activeBusinessId && activeBusinessId !== ALL_BUSINESSES
        ? `?business=${encodeURIComponent(activeBusinessId)}`
        : "";
    void fetch(`/api/messages${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { leads?: unknown[] } | null) => {
        if (cancelled || !d) return;
        const list = (d.leads ?? []).map((raw) => {
          const l = raw as DashLead & { createdAt: string };
          return { ...l, createdAt: new Date(l.createdAt) } as DashLead;
        });
        setLeads(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeBusinessId]);

  return (
    <div className="flex-1 min-w-0 overflow-y-auto flex flex-col bg-preview-a">
      {leads ? (
        <MessagesView leads={leads} />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      )}
    </div>
  );
}
